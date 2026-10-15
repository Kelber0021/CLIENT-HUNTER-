import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const number = new Intl.NumberFormat('pt-BR')

/** Numbers roll to their new value, so a growing result count reads as live progress. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef({ value: 0 })
  useGSAP(() => {
    const element = ref.current
    if (!element) return
    const render = () => { element.textContent = number.format(Math.round(shown.current.value)) }
    if (reducedMotion()) { shown.current.value = value; render(); return }
    gsap.to(shown.current, { value, duration: Math.min(1.4, .45 + Math.abs(value - shown.current.value) / 4000), ease: 'power2.out', overwrite: true, onUpdate: render })
  }, { dependencies: [value] })
  return <span ref={ref} className={className}>{number.format(0)}</span>
}

/** One orchestrated arrival for the overview: headline lines rise, the atlas opens, the stats settle. */
export function useOverviewIntro(scope: React.RefObject<HTMLElement | null>) {
  useGSAP(() => {
    if (reducedMotion()) return
    const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } })
    timeline
      .from('.intro-line > span', { yPercent: 105, duration: .8, stagger: .09 })
      .from('.intro-fade', { autoAlpha: 0, y: 14, duration: .55, stagger: .07 }, '-=.45')
      .from('.atlas-hero-visual', { clipPath: 'inset(0 0 100% 0 round 3px 22px 3px 3px)', duration: 1, ease: 'power3.inOut' }, .1)
      .from('.overview-actions > button', { autoAlpha: 0, y: 18, duration: .5, stagger: .08 }, '-=.5')
      .from('.overview-explain > div', { autoAlpha: 0, x: -10, duration: .45, stagger: .07 }, '-=.35')
  }, { scope })
}

export { gsap, useGSAP }
