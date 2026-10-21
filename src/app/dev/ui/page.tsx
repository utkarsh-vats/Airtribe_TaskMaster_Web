import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BrandMark } from '@/components/shell/BrandMark';
import { ThemeSwitch } from '@/components/shell/ThemeSwitch';

export const metadata: Metadata = { title: 'UI' };

// Dev-only token / component showcase (the prototype's "Tokens & components" view).
// Step 2 grows this into the full UI kit page.
export default function DevUiPage() {
    if (process.env.NODE_ENV === 'production') notFound();

    return (
        <div className="flex min-h-screen flex-col">
            <header className="nav gap-3">
                <BrandMark />
                <ThemeSwitch />
            </header>

            <main className="flex max-w-[1100px] flex-col gap-8 p-6">
                <div className="border-b-rule border-divider pb-4">
                    <div className="card-kicker text-accent-700">Dev</div>
                    <h2 className="m-0">Tokens &amp; components</h2>
                    <p className="text-muted mt-2 mb-0 max-w-[70ch]">
                        Modernist base (Archivo, 0 radius, 2px rules) with the TaskMaster teal
                        accent. Use the switch above to see both themes.{' '}
                        <a href="https://github.com/utkarsh-vats/Airtribe_TaskMaster">
                            Backend repo
                        </a>
                    </p>
                </div>

                <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <div className="flex flex-col gap-2">
                        <h6 className="text-muted m-0">Buttons</h6>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" className="btn btn-primary">
                                Primary
                            </button>
                            <button type="button" className="btn btn-secondary">
                                Secondary
                            </button>
                            <button type="button" className="btn btn-ghost">
                                Ghost
                            </button>
                            <button type="button" className="btn btn-primary" disabled>
                                Disabled
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <h6 className="text-muted m-0">Tags</h6>
                        <div className="flex flex-wrap gap-2">
                            <span className="tag tag-neutral">To do</span>
                            <span className="tag tag-accent">In progress</span>
                            <span className="tag tag-outline">Done</span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <h6 className="text-muted m-0">Priority marks</h6>
                        <div className="flex gap-4 text-sm">
                            {(
                                [
                                    ['Urgent', 'bg-danger'],
                                    ['High', 'bg-prio-high'],
                                    ['Medium', 'bg-prio-medium'],
                                    ['Low', 'bg-prio-low'],
                                ] as const
                            ).map(([label, color]) => (
                                <div key={label} className="flex items-center gap-[6px]">
                                    <div aria-hidden className={`h-2 w-2 ${color}`} />
                                    {label}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <h6 className="text-muted m-0">Field</h6>
                        <div className="field">
                            <label htmlFor="demo-title">Title</label>
                            <input
                                id="demo-title"
                                className="input"
                                placeholder="What needs doing?"
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <h6 className="text-muted m-0">Card</h6>
                        <div className="card elev-sm">
                            <div className="text-muted text-xs">Website relaunch · High</div>
                            <div className="card-title text-[15px]">
                                Finalise homepage hero copy
                            </div>
                            <div className="card-meta">Oct 23 · MO</div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <h6 className="text-muted m-0">Headings</h6>
                        <h1 className="m-0">Heading 1</h1>
                        <h3 className="m-0">Heading 3</h3>
                        <h5 className="m-0">Heading 5</h5>
                        <p className="m-0">Body text at 15px / 1.55 in Archivo.</p>
                    </div>
                </section>
            </main>
        </div>
    );
}
