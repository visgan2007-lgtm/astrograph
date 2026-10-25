import { motion, type Variants } from 'framer-motion';
import { createElement } from 'react';
import { useSettings } from '../context/SettingsContext';

type Tag = 'h1' | 'h2' | 'h3' | 'p' | 'span';

interface Props {
  text: string;
  as?: Tag;
  /** `char` staggers every character, `word` every word */
  mode?: 'char' | 'word';
  className?: string;
  /** seconds before the reveal starts */
  delay?: number;
  /** seconds between units */
  stagger?: number;
}

/**
 * Ghost reveal: characters (or words) fade in from a blurred, slightly lowered state with a stagger.
 * Hovering the heading makes it ghost out and back in again, in a wave.
 */
export default function GhostText({ text, as = 'h2', mode = 'char', className = '', delay = 0, stagger = 0.03 }: Props) {
  const { dur, reducedMotion } = useSettings();
  if (reducedMotion) return createElement(as, { className }, text);

  const MotionTag = motion[as] as typeof motion.h2;
  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: dur(stagger), delayChildren: dur(delay) } },
    ghost: { transition: { staggerChildren: dur(stagger * 0.7) } },
  };
  const unit: Variants = {
    hidden: { opacity: 0, y: '0.35em', filter: 'blur(8px)' },
    show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: dur(0.55), ease: [0.22, 1, 0.36, 1] } },
    ghost: {
      opacity: [1, 0.15, 1],
      y: [0, '-0.12em', 0],
      filter: ['blur(0px)', 'blur(3px)', 'blur(0px)'],
      transition: { duration: dur(0.75), ease: 'easeInOut' },
    },
  };

  const words = text.split(' ');
  return (
    <MotionTag
      key={text}
      className={`ghost ${className}`}
      aria-label={text}
      variants={container}
      initial="hidden"
      animate="show"
      whileHover="ghost"
    >
      {words.map((word, wi) => (
        <span className="ghost-word" key={`${word}-${wi}`} aria-hidden="true">
          {mode === 'word' ? (
            <motion.span className="ghost-unit" variants={unit}>
              {word}
            </motion.span>
          ) : (
            Array.from(word).map((ch, ci) => (
              <motion.span className="ghost-unit" variants={unit} key={ci}>
                {ch}
              </motion.span>
            ))
          )}
          {wi < words.length - 1 ? '\u00a0' : ''}
        </span>
      ))}
    </MotionTag>
  );
}
