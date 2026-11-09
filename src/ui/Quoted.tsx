/**
 * A claim, in its quotation marks. The marks are the only ornament in the app:
 * the opening one hangs in the margin, and the closing one never wraps onto a
 * line of its own.
 */
export function Quoted({ text }: { text: string }) {
  const cut = text.lastIndexOf(' ');
  const head = cut < 0 ? '' : text.slice(0, cut + 1);
  const tail = cut < 0 ? text : text.slice(cut + 1);
  return (
    <span className="q">
      <span className="q__open">“</span>
      {head}
      <span className="q__last">
        {tail}
        <span className={`q__close${/f$/.test(text) ? ' q__close--f' : ''}`}>”</span>
      </span>
    </span>
  );
}
