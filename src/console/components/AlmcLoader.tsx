interface AlmcLoaderProps {
  size?: number;
  className?: string;
}

/** ALMC page/section loader — rotating circle (no Airaplay logo). */
export function AlmcLoader({ size = 40, className = '' }: AlmcLoaderProps): JSX.Element {
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      role="status"
      aria-label="Loading"
    >
      <div className="relative" style={{ width: size, height: size }}>
        <div className="absolute inset-0 animate-loading-rotate">
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--almc-lime)] border-r-[var(--almc-lime)] opacity-80" />
        </div>
        <div className="absolute inset-0 animate-loading-rotate-reverse">
          <div className="absolute inset-[12%] rounded-full border-2 border-transparent border-b-[var(--almc-lime-deep)] border-l-[var(--almc-lime-deep)] opacity-45" />
        </div>
      </div>
    </div>
  );
}
