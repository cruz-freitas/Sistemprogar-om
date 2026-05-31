import { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  subtitle,
  actions,
}: {
  title: string;
  description?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const sub = description || subtitle;
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
