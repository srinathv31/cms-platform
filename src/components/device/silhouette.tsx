/** The generic contact silhouette, a head and shoulders, in `currentColor`: an unknown sender's avatar. */
export function Silhouette({ className = "size-full" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className={className} fill="currentColor">
      <circle cx="24" cy="19" r="8.6" />
      <path d="M8.6 41.5C11 33.6 17 29.6 24 29.6s13 4 15.4 11.9A20.4 20.4 0 0 1 24 48a20.4 20.4 0 0 1-15.4-6.5Z" />
    </svg>
  );
}
