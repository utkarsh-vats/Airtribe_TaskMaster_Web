import type { ReactNode } from 'react';

/** The prototype's display statement: "Tasks, in order." at poster size, plus a pitch line. */
export function HeroStatement({ children }: { children?: ReactNode }) {
    return (
        <div>
            <p className="m-0 font-heading text-[clamp(44px,7vw,88px)] leading-[0.95] font-extrabold tracking-[-0.03em]">
                Tasks,
                <br />
                in order.
            </p>
            <p className="mt-4 mb-0 max-w-[34ch] text-[16px]">
                Projects, boards and teammates in one place. Nothing extra.
            </p>
            {children}
        </div>
    );
}
