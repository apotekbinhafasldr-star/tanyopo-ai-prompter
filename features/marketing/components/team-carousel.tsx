"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface TeamSlide {
  id: string;
  image: string;
  imageAlt: string;
  /** A pre-rendered icon element (not a component reference — component
   * references can't cross the server/client boundary as props). */
  icon: ReactNode;
  /** First word(s) of the title, in white. */
  titleLead: string;
  /** Remaining word(s) of the title, in the brand gradient — mirrors the
   * two-tone title treatment from the reference feature cards. */
  titleAccent: string;
  message: string;
  ctaLabel: string;
  ctaHref: string;
}

export function TeamCarousel({ slides }: { slides: TeamSlide[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!mostVisible) return;
        const index = slideRefs.current.findIndex((el) => el === mostVisible.target);
        if (index !== -1) setActiveIndex(index);
      },
      { root: track, threshold: [0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    );

    slideRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [slides.length]);

  const goTo = (index: number) => {
    const clamped = Math.max(0, Math.min(slides.length - 1, index));
    const target = slideRefs.current[clamped];
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  };

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Tim marketing AI"
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") goTo(activeIndex + 1);
        if (event.key === "ArrowLeft") goTo(activeIndex - 1);
      }}
    >
      <div
        ref={trackRef}
        tabIndex={0}
        className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 pb-2 sm:gap-6 sm:px-[8%] sm:[scroll-padding-inline:8%] lg:px-[12%] lg:[scroll-padding-inline:12%]"
      >
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            ref={(el) => {
              slideRefs.current[index] = el;
            }}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} dari ${slides.length}: ${slide.titleLead} ${slide.titleAccent}`}
            className="w-[85%] shrink-0 snap-center sm:w-[60%] lg:w-[42%]"
          >
            {/* Full-bleed photo card — title, icon, and description all live
                inside the image itself (a scrim + overlay), not in a
                separate text panel below or beside it. */}
            <a
              href={slide.ctaHref}
              aria-label={`${slide.titleLead} ${slide.titleAccent} — ${slide.message}`}
              className="group relative flex aspect-[4/5] w-full flex-col justify-end overflow-hidden rounded-[var(--radius-xl)] border border-border shadow-[var(--shadow-md)] transition-shadow duration-300 hover:shadow-[var(--shadow-lg)] focus-visible:shadow-[var(--shadow-lg)] sm:aspect-[3/4]"
            >
              <Image
                src={slide.image}
                alt={slide.imageAlt}
                fill
                sizes="(min-width: 1024px) 40vw, (min-width: 640px) 55vw, 85vw"
                className="object-cover transition-transform duration-500 motion-reduce:transition-none group-hover:scale-[1.03]"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-ink via-ink/55 to-ink/5"
              />

              <div className="relative flex flex-col gap-2 p-4 sm:p-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-brand-foreground shadow-[var(--shadow-sm)] [&_svg]:size-4">
                  {slide.icon}
                </span>
                <h3 className="text-lg font-semibold leading-tight text-white sm:text-xl">
                  {slide.titleLead}{" "}
                  <span className="bg-gradient-to-r from-[#22d3ee] via-[#3b82f6] to-[#8b5cf6] bg-clip-text text-transparent">
                    {slide.titleAccent}
                  </span>
                </h3>
                <p className="text-sm leading-relaxed text-white/75">{slide.message}</p>
                <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-white/90 transition-colors group-hover:text-white">
                  {slide.ctaLabel}
                  <ChevronRight className="size-4" aria-hidden />
                </span>
              </div>
            </a>
          </div>
        ))}
      </div>

      <p className="mt-3 text-center text-xs text-muted-foreground sm:hidden">
        Geser untuk menjelajah →
      </p>

      <div className="mt-4 hidden items-center justify-center gap-4 sm:flex">
        <button
          type="button"
          aria-label="Slide sebelumnya"
          onClick={() => goTo(activeIndex - 1)}
          disabled={activeIndex === 0}
          className="flex size-9 items-center justify-center rounded-full border border-border-strong text-foreground transition-colors hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>

        <div className="flex items-center gap-1.5">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Ke slide ${index + 1}: ${slide.titleLead} ${slide.titleAccent}`}
              aria-current={index === activeIndex}
              onClick={() => goTo(index)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                index === activeIndex ? "w-6 bg-brand" : "w-1.5 bg-border-strong hover:bg-muted-foreground",
              )}
            />
          ))}
        </div>

        <button
          type="button"
          aria-label="Slide berikutnya"
          onClick={() => goTo(activeIndex + 1)}
          disabled={activeIndex === slides.length - 1}
          className="flex size-9 items-center justify-center rounded-full border border-border-strong text-foreground transition-colors hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5 sm:hidden">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            aria-label={`Ke slide ${index + 1}: ${slide.titleLead} ${slide.titleAccent}`}
            aria-current={index === activeIndex}
            onClick={() => goTo(index)}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              index === activeIndex ? "w-6 bg-brand" : "w-1.5 bg-border-strong",
            )}
          />
        ))}
      </div>
    </div>
  );
}
