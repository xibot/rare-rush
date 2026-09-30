import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import './help-menu.css';

/** Free Play lives in a scrolling page, so its help belongs in the top layer,
 * outside the game grid's clipping and container-query coordinate space. */
export function FreePlayMenu({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="free-play-help" aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="free-play-help-heading"><h2 id={id}>{title}</h2>
      <button type="button" autoFocus onClick={onClose} aria-label={`Close ${title}`}>×</button>
    </header>
    <div className="free-play-help-body" tabIndex={0} role="region" aria-label="Game instructions">{children}</div>
  </dialog>;
}
