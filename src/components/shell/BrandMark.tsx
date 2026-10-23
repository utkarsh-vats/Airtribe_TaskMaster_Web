import Link from 'next/link';

/**
 * Accent square + "TaskMaster", as in the prototype header. Links home when `href` is set.
 * In a crowded bar the name truncates rather than pushing the bar wider than the screen.
 */
export function BrandMark({ href }: { href?: string }) {
    const content = (
        <>
            <span aria-hidden className="block h-[14px] w-[14px] flex-none bg-accent" />
            <span className="min-w-0 truncate">TaskMaster</span>
        </>
    );

    return href ? (
        <Link
            href={href}
            className="nav-brand flex min-w-0 items-center gap-2 text-text no-underline"
        >
            {content}
        </Link>
    ) : (
        <div className="nav-brand flex min-w-0 items-center gap-2">{content}</div>
    );
}
