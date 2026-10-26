import type { GraphPayload } from '../types';

export interface HealthFactor {
  label: string;
  /** points subtracted from 100 */
  penalty: number;
  note: string;
}
export interface Health {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  factors: HealthFactor[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Architectural health: 100 minus penalties for cycles, complexity, coupling and unparseable files. */
export function computeHealth(g: GraphPayload): Health {
  const n = Math.max(1, g.nodes.length);
  const inCycle = new Set(g.cycles.flatMap((c) => c.members)).size;
  const hot = g.nodes.filter((x) => x.complexity >= 40).length;
  const coupled = g.nodes.filter((x) => x.in_degree + x.out_degree >= 12).length;

  const factors: HealthFactor[] = [
    {
      label: 'Circular dependencies',
      penalty: Math.round(clamp(g.cycles.length * 6 + (inCycle / n) * 40, 0, 30)),
      note: `${g.cycles.length} cluster(s) touching ${inCycle} module(s)`,
    },
    {
      label: 'Average complexity',
      penalty: Math.round(clamp((g.stats.avg_complexity - 6) * 2.5, 0, 20)),
      note: `${g.stats.avg_complexity} per module`,
    },
    { label: 'Complexity hot spots', penalty: Math.round(clamp((hot / n) * 60, 0, 15)), note: `${hot} module(s) at complexity 40+` },
    { label: 'Tight coupling', penalty: Math.round(clamp((coupled / n) * 75, 0, 15)), note: `${coupled} module(s) with 12+ links` },
    { label: 'Unparseable files', penalty: Math.round(clamp((g.stats.parse_errors / n) * 50, 0, 10)), note: `${g.stats.parse_errors} file(s)` },
    {
      label: 'Entry points',
      penalty: n > 3 && g.entry_points.length === 0 ? 5 : 0,
      note: g.entry_points.length ? `${g.entry_points.length} found` : 'none detected',
    },
  ];
  const score = clamp(100 - factors.reduce((s, f) => s + f.penalty, 0), 0, 100);
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'F';
  return { score, grade, factors };
}
