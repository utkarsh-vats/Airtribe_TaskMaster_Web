import type { CSSProperties } from 'react';

/*
 * Decorative line-drawn task board for the accent hero panels: three column outlines over a
 * faint modular grid, with cards drifting To do → In progress → Done. Pure SVG + CSS
 * (src/styles/hero-graphic.css); colours come from --color-bg via currentColor.
 *
 * Geometry is in viewBox units (1200 × 900). `xMaxYMax slice` anchors the bottom-right corner,
 * so the board stays at the panel's right/bottom edge and the columns run off the bottom.
 */

const VIEW_W = 1200;
const VIEW_H = 900;
const GRID = 60;

// Board is 448 wide with a 24 margin on the right, so all three columns stay in view down to
// a panel about half as wide as it is tall (the landing hero at 375px).
const COL_X = 728;
const COL_W = 140;
/** Distance between columns; the cards' keyframes move by multiples of this. */
const COL_STEP = 154;
const COL_TOP = 344;

const CARD_INSET = 12;
const CARD_W = COL_W - 2 * CARD_INSET;
const CARD_H = 52;
const SLOT_TOP = 404;
const SLOT_STEP = 68;

const COLUMNS = ['TO DO', 'IN PROGRESS', 'DONE'] as const;

type CardSpec = {
    col: number;
    slot: number;
    /** Widths of the two placeholder text lines. */
    lines: readonly [number, number];
    filled?: boolean;
};

const STATIC_CARDS: readonly CardSpec[] = [
    { col: 0, slot: 0, lines: [64, 52] },
    { col: 0, slot: 1, lines: [52, 70] },
    { col: 1, slot: 0, lines: [70, 44], filled: true },
    { col: 2, slot: 0, lines: [58, 60], filled: true },
    { col: 2, slot: 1, lines: [46, 76] },
];

/**
 * Cards that travel. Each has its own row (so they never overlap), loop length and phase
 * (so no two move together), and a resting column for the reduced-motion frame.
 */
const MOVING_CARDS: readonly (CardSpec & { duration: number; delay: number; restCol: number })[] = [
    { col: 0, slot: 2, lines: [66, 48], duration: 16, delay: -3, restCol: 1 },
    { col: 0, slot: 3, lines: [50, 72], duration: 19, delay: -11, restCol: 2 },
    { col: 0, slot: 4, lines: [60, 56], duration: 14, delay: -8, restCol: 1 },
];

const gridPath = [
    ...Array.from({ length: VIEW_W / GRID - 1 }, (_, i) => `M${(i + 1) * GRID} 0V${VIEW_H}`),
    ...Array.from({ length: VIEW_H / GRID - 1 }, (_, i) => `M0 ${(i + 1) * GRID}H${VIEW_W}`),
].join('');

function Card({ col, slot, lines, filled = false }: CardSpec) {
    const x = COL_X + col * COL_STEP + CARD_INSET;
    const y = SLOT_TOP + slot * SLOT_STEP;
    return (
        <>
            <rect
                className={filled ? 'hg-card hg-card-filled' : 'hg-card'}
                x={x}
                y={y}
                width={CARD_W}
                height={CARD_H}
            />
            {/* priority mark + title line, then a shorter meta line */}
            <rect className="hg-mark" x={x + 12} y={y + 13} width={8} height={8} />
            <path
                className="hg-line"
                d={`M${x + 28} ${y + 17}h${lines[0]}M${x + 12} ${y + 36}h${lines[1]}`}
            />
        </>
    );
}

export function HeroGraphic() {
    return (
        <svg
            aria-hidden
            focusable="false"
            className="hero-graphic"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMaxYMax slice"
        >
            <path className="hg-grid" d={gridPath} />

            {COLUMNS.map((label, i) => {
                const x = COL_X + i * COL_STEP;
                return (
                    <g key={label}>
                        {/* Taller than the view so the column runs off the bottom edge. */}
                        <rect className="hg-col" x={x} y={COL_TOP} width={COL_W} height={VIEW_H} />
                        <text className="hg-label" x={x + CARD_INSET} y={COL_TOP + 27}>
                            {label}
                        </text>
                        <path className="hg-rule" d={`M${x} ${COL_TOP + 44}h${COL_W}`} />
                    </g>
                );
            })}

            {STATIC_CARDS.map((card) => (
                <Card key={`${card.col}-${card.slot}`} {...card} />
            ))}

            {MOVING_CARDS.map(({ duration, delay, restCol, ...card }) => (
                <g
                    key={`m-${card.slot}`}
                    className="hg-mover"
                    style={
                        {
                            '--hg-step': `${COL_STEP}px`,
                            '--hg-rest': `${restCol * COL_STEP}px`,
                            animationDuration: `${duration}s`,
                            animationDelay: `${delay}s`,
                        } as CSSProperties
                    }
                >
                    <Card {...card} />
                </g>
            ))}
        </svg>
    );
}
