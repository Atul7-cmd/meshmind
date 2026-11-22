import unittest

from graph_processor import (
    MAX_NODES,
    GraphValidationError,
    build_graph,
    find_components,
    find_cycles,
    slugify,
)


def node(id_, label=None, type_="service"):
    return {"id": id_, "label": label or id_.title(), "type": type_}


def edge(source, target, label="calls"):
    return {"source": source, "target": target, "label": label}


class BuildGraphHappyPath(unittest.TestCase):
    def test_example_from_the_brief(self):
        raw = {
            "nodes": [node("user", "User Service"), node("auth", "Authentication Service"),
                      node("auth_db", "Auth Database", "database")],
            "edges": [edge("user", "auth", "communicates with"), edge("auth", "auth_db", "connects to")],
            "summary": "A small architecture.",
        }
        graph = build_graph(raw)
        self.assertEqual([n["id"] for n in graph["nodes"]], ["user", "auth", "auth_db"])
        self.assertEqual(len(graph["edges"]), 2)
        self.assertEqual(graph["summary"], "A small architecture.")
        a = graph["analysis"]
        self.assertEqual((a["service_count"], a["database_count"], a["edge_count"]), (2, 1, 2))
        self.assertFalse(a["has_cycles"])
        self.assertEqual(a["component_count"], 1)
        self.assertEqual(a["warnings"], [])

    def test_type_synonyms_are_normalised(self):
        graph = build_graph({"nodes": [node("a", type_="Microservice"), node("b", type_="DB")], "edges": []})
        self.assertEqual([n["type"] for n in graph["nodes"]], ["service", "database"])

    def test_missing_summary_gets_generated_one(self):
        graph = build_graph({"nodes": [node("a"), node("b")], "edges": [edge("a", "b")]})
        self.assertIn("2 services", graph["summary"])
        self.assertIn("1 dependency", graph["summary"])

    def test_edge_label_defaults(self):
        graph = build_graph({"nodes": [node("a"), node("b")], "edges": [edge("a", "b", "  ")]})
        self.assertEqual(graph["edges"][0]["label"], "depends on")

    def test_edges_may_reference_labels_instead_of_ids(self):
        raw = {"nodes": [node("x1", "Order Service"), node("x2", "Payment Service")],
               "edges": [edge("Order Service", "payment service")]}
        graph = build_graph(raw)
        self.assertEqual((graph["edges"][0]["source"], graph["edges"][0]["target"]), ("x1", "x2"))

    def test_labels_are_cleaned(self):
        graph = build_graph({"nodes": [node("a", "  Auth \n  Service\t")], "edges": []})
        self.assertEqual(graph["nodes"][0]["label"], "Auth Service")

    def test_non_latin_labels_get_fallback_ids(self):
        graph = build_graph({"nodes": [{"label": "भुगतान सेवा", "type": "service"},
                                       {"label": "ऑर्डर सेवा", "type": "service"}], "edges": []})
        ids = [n["id"] for n in graph["nodes"]]
        self.assertEqual(len(set(ids)), 2)


class DuplicateNodes(unittest.TestCase):
    def test_same_label_is_merged_and_edges_still_resolve(self):
        raw = {"nodes": [node("db", "Auth Database", "database"), node("auth", "Auth Service"),
                         node("auth_db", "auth database", "database")],
               "edges": [edge("auth", "auth_db", "reads from")]}
        graph = build_graph(raw)
        self.assertEqual(len(graph["nodes"]), 2)
        self.assertEqual(graph["edges"][0]["target"], "db")
        self.assertTrue(any("Merged duplicate" in w for w in graph["analysis"]["warnings"]))

    def test_same_id_different_label_gets_unique_id(self):
        raw = {"nodes": [node("db", "Auth Database", "database"), node("db", "Payment Database", "database")],
               "edges": []}
        graph = build_graph(raw)
        ids = [n["id"] for n in graph["nodes"]]
        self.assertEqual(len(ids), 2)
        self.assertEqual(len(set(ids)), 2)
        self.assertTrue(any("used for two components" in w for w in graph["analysis"]["warnings"]))

    def test_conflicting_types_keep_first(self):
        raw = {"nodes": [node("a", "Thing", "service"), node("b", "thing", "database")], "edges": []}
        graph = build_graph(raw)
        self.assertEqual(graph["nodes"][0]["type"], "service")
        self.assertEqual(len(graph["nodes"]), 1)


class InvalidEdges(unittest.TestCase):
    def test_unknown_reference_is_dropped_with_warning(self):
        graph = build_graph({"nodes": [node("a"), node("b")], "edges": [edge("a", "ghost"), edge("a", "b")]})
        self.assertEqual(len(graph["edges"]), 1)
        self.assertTrue(any("ghost" in w for w in graph["analysis"]["warnings"]))

    def test_self_loop_is_dropped(self):
        graph = build_graph({"nodes": [node("a"), node("b")], "edges": [edge("a", "a"), edge("a", "b")]})
        self.assertEqual(len(graph["edges"]), 1)

    def test_repeated_edge_is_dropped_but_different_label_kept(self):
        raw = {"nodes": [node("a"), node("b")],
               "edges": [edge("a", "b", "calls"), edge("a", "b", "CALLS"), edge("a", "b", "reads")]}
        graph = build_graph(raw)
        self.assertEqual([e["label"] for e in graph["edges"]], ["calls", "reads"])

    def test_non_object_edge_and_missing_endpoints(self):
        graph = build_graph({"nodes": [node("a"), node("b")],
                             "edges": ["a->b", {"source": "a"}, {"target": "b"}, edge("a", "b")]})
        self.assertEqual(len(graph["edges"]), 1)
        self.assertEqual(len(graph["analysis"]["warnings"]), 3)

    def test_missing_edges_key_means_no_edges(self):
        graph = build_graph({"nodes": [node("a")]})
        self.assertEqual(graph["edges"], [])


class InvalidAiOutput(unittest.TestCase):
    def test_not_a_dict(self):
        with self.assertRaises(GraphValidationError) as ctx:
            build_graph([1, 2])
        self.assertEqual(ctx.exception.status_code, 502)

    def test_missing_nodes_key(self):
        with self.assertRaises(GraphValidationError) as ctx:
            build_graph({"edges": []})
        self.assertEqual(ctx.exception.code, "invalid_ai_response")

    def test_edges_wrong_type(self):
        with self.assertRaises(GraphValidationError):
            build_graph({"nodes": [node("a")], "edges": "a->b"})

    def test_empty_nodes_is_a_user_facing_error(self):
        with self.assertRaises(GraphValidationError) as ctx:
            build_graph({"nodes": [], "edges": []})
        self.assertEqual((ctx.exception.status_code, ctx.exception.code), (422, "no_components"))

    def test_all_nodes_invalid(self):
        with self.assertRaises(GraphValidationError) as ctx:
            build_graph({"nodes": [{"label": "X", "type": "queue"}, 5, {"type": "service"}], "edges": []})
        self.assertEqual(ctx.exception.code, "no_components")

    def test_too_many_nodes(self):
        raw = {"nodes": [node(f"n{i}") for i in range(MAX_NODES + 1)], "edges": []}
        with self.assertRaises(GraphValidationError) as ctx:
            build_graph(raw)
        self.assertEqual(ctx.exception.code, "graph_too_large")


class GraphAnalysis(unittest.TestCase):
    def test_disconnected_components_and_isolated_nodes(self):
        raw = {"nodes": [node("a"), node("b"), node("c"), node("d"), node("lonely")],
               "edges": [edge("a", "b"), edge("c", "d")]}
        a = build_graph(raw)["analysis"]
        self.assertEqual(a["component_count"], 3)
        self.assertEqual(a["isolated"], ["lonely"])
        self.assertTrue(any("Not connected" in w for w in a["warnings"]))

    def test_components_ignore_edge_direction(self):
        comps = find_components(["a", "b", "c"], [edge("b", "a"), edge("b", "c")])
        self.assertEqual(comps, [["a", "b", "c"]])

    def test_two_node_cycle(self):
        graph = build_graph({"nodes": [node("a"), node("b")], "edges": [edge("a", "b"), edge("b", "a")]})
        self.assertEqual(graph["analysis"]["cycles"], [["a", "b", "a"]])
        self.assertTrue(graph["analysis"]["has_cycles"])
        self.assertIn("Circular dependency detected", graph["summary"])

    def test_three_node_cycle_reported_once(self):
        edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")]
        self.assertEqual(find_cycles(["a", "b", "c"], edges), [["a", "b", "c", "a"]])

    def test_dag_has_no_cycle(self):
        edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")]
        self.assertEqual(find_cycles(["a", "b", "c", "d"], edges), [])

    def test_cycle_not_at_graph_root(self):
        edges = [edge("a", "b"), edge("b", "c"), edge("c", "b")]
        self.assertEqual(find_cycles(["a", "b", "c"], edges), [["b", "c", "b"]])

    def test_slugify(self):
        self.assertEqual(slugify("Auth  Database!"), "auth_database")
        self.assertEqual(slugify(None), "")
        self.assertEqual(slugify("日本"), "")


if __name__ == "__main__":
    unittest.main()
