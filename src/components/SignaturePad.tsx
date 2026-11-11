"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Signaturfelt: tegn med finger, penn eller mus. Signaturen legges i et skjult felt «signature» som PNG.
 * Skjemaet kan ikke sendes før det er tegnet noe.
 */
export function SignaturePad({ label = "Signer her" }: { label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(r.width * ratio);
      c.height = Math.round(r.height * ratio);
      const ctx = c.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#16202b";
      setEmpty(true);
      if (input.current) input.current.value = "";
    };
    fit();
    // Mobil roterer: tegn på nytt i riktig størrelse
    window.addEventListener("orientationchange", fit);
    return () => window.removeEventListener("orientationchange", fit);
  }, []);

  // Hindre at siden ruller mens man signerer på mobil
  useEffect(() => {
    const c = canvas.current!;
    const stop = (e: TouchEvent) => e.preventDefault();
    c.addEventListener("touchmove", stop, { passive: false });
    return () => c.removeEventListener("touchmove", stop);
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
    const ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1, 0, Math.PI * 2);
    ctx.fillStyle = "#16202b";
    ctx.fill();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const p = pos(e);
    const ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    setEmpty(false);
    if (input.current) {
      input.current.value = canvas.current!.toDataURL("image/png");
      input.current.setCustomValidity("");
    }
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    if (input.current) input.current.value = "";
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="label mb-0">{label}</span>
        {!empty && <button type="button" onClick={clear} className="text-sm font-semibold text-brand">Tøm</button>}
      </div>
      <div className="relative rounded-lg border-2 border-dashed border-line bg-white">
        <canvas
          ref={canvas}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="block h-40 w-full cursor-crosshair touch-none"
          aria-label="Signaturfelt. Tegn signaturen din med finger eller mus."
        />
        {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">Skriv signaturen din med fingeren</span>}
        <span className="pointer-events-none absolute bottom-8 left-4 right-4 border-b border-line" />
      </div>
      {/* required + tomt felt stopper innsending til det er signert */}
      <input ref={input} name="signature" required className="sr-only" tabIndex={-1} aria-hidden onInvalid={(e) => (e.target as HTMLInputElement).setCustomValidity("Signer i feltet først.")} onInput={(e) => (e.target as HTMLInputElement).setCustomValidity("")} />
    </div>
  );
}
