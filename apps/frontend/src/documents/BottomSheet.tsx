import { useState, useEffect, useRef } from 'react';


interface Props {
  onClose: () => void;
  children: React.ReactNode;
}

export default function BottomSheet({ onClose, children }: Props) {
  const [visible, setVisible] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => {
      cancelAnimationFrame(id);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function close() {
    setVisible(false);
    closeTimer.current = setTimeout(onClose, 320);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    dragStartY.current = e.clientY;
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging.current) return;
    setDragOffset(Math.max(0, e.clientY - dragStartY.current));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    isDragging.current = false;
    if (e.clientY - dragStartY.current > 80) {
      close();
    } else {
      setDragOffset(0);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />
      <div
        className="relative w-full max-h-[90vh] bg-surface rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          transform: !visible ? 'translateY(100%)' : dragOffset > 0 ? `translateY(${dragOffset}px)` : 'translateY(0)',
          transition: isDragging.current ? 'none' : 'transform 0.32s cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        <div
          className="flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="w-12 h-1.5 bg-edge rounded-full" />
        </div>
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
