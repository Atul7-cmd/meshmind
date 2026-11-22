export default function ErrorBanner({ message, onDismiss }) {
  return (
    <div className="banner banner--error" role="alert">
      <p>{message}</p>
      <button type="button" className="btn btn--quiet btn--small" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
