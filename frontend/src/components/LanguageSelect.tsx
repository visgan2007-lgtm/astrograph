import { motion } from 'framer-motion';
import { LANGUAGES } from '../lib/languages';

interface Props {
  /** selected language ids; empty means auto-detect */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/** Auto-detect (default) or pick one or more languages to analyse. */
export default function LanguageSelect({ value, onChange, disabled }: Props) {
  const auto = value.length === 0;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="langs" role="group" aria-label="Languages to analyse">
      <motion.button type="button" className="lang-chip" aria-pressed={auto} disabled={disabled} whileTap={{ scale: 0.94 }} onClick={() => onChange([])}>
        Auto-detect
      </motion.button>
      {LANGUAGES.map((l) => (
        <motion.button
          key={l.id}
          type="button"
          className="lang-chip"
          aria-pressed={value.includes(l.id)}
          disabled={disabled}
          title={l.extensions}
          whileTap={{ scale: 0.94 }}
          onClick={() => toggle(l.id)}
        >
          {l.label}
        </motion.button>
      ))}
    </div>
  );
}
