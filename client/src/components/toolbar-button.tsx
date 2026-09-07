// Shared round pill button used in admin toolbars (article management,
// showcase management, ...).
export function ToolbarButton({
  title,
  onClick,
  danger = false,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "border-red-200 text-red-500 hover:border-red-300 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-900/20"
          : "border-black/10 bg-w t-primary hover:border-black/25 dark:border-white/10 dark:hover:border-white/25"
      }`}
    >
      {title}
    </button>
  );
}
