import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/** Every network read is loading, failed or ready. Failed never renders as empty (DESIGN.md §2.5). */
export type Load<T> = { status: "loading" } | { status: "failed" } | { status: "ready"; data: T };

export function loading<T>(): Load<T> {
  return { status: "loading" };
}

/** Applies a request's three states to a state setter, so no call site can drop the failure case. */
export function track<T>(apply: (state: Load<T>) => void, request: Promise<T>): void {
  apply({ status: "loading" });
  request
    .then((data) => apply({ status: "ready", data }))
    .catch(() => apply({ status: "failed" }));
}

export function TopBar({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <header className="topbar">
      <p className="topbar__brand">Клинический компас</p>
      <span className="topbar__spacer" />
      <span className="topbar__email">{email}</span>
      <Button variant="quiet" onClick={onSignOut}>
        Выйти
      </Button>
    </header>
  );
}

export type TabItem<T extends string> = { id: T; label: string; count?: number | null };

export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  const bar = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  /*
   * The row wraps instead of scrolling (#48 revised the scrolling choice of #35): a
   * clipped row hid two patient sections behind a fade that read as the edge of the
   * row. The fade stays for the row that cannot wrap — a single label wider than the
   * row at a phone zoomed to 200–250 % — so a cut label is still announced. It may only
   * be there when something really is cut off: a fade over a fully visible tab reads as
   * «этот раздел недоступен». So the row is measured: on resize, when the number of
   * tabs changes, and once the font has loaded, because Lato's metrics decide the last
   * few pixels.
   */
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    let live = true;
    const measure = () => setOverflowing(node.scrollWidth > node.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [items.length]);

  return (
    <div
      ref={bar}
      className={overflowing ? "tabs tabs--overflow" : "tabs"}
      role="tablist"
      aria-label={label}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className="tab"
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count != null && <span className="tab__count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `card ${className}` : "card"}>
      {title && <h2 className="card__title">{title}</h2>}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="notice">{children}</p>;
}

export function LoadError({ children, onRetry }: { children: string; onRetry?: () => void }) {
  return (
    <div className="load-error" role="alert">
      <p className="notice notice--error">{children}</p>
      {onRetry && <Button onClick={onRetry}>Повторить</Button>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
};

export function Button({ variant = "secondary", className, ...rest }: ButtonProps) {
  const classes = ["button", variant === "secondary" ? "" : `button--${variant}`, className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <button type="button" className={classes} {...rest} />;
}
