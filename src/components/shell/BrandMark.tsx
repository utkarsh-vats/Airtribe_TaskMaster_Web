import Link from 'next/link';

/** Accent square + "TaskMaster", as in the prototype header. Links home when `href` is set. */
export function BrandMark({ href }: { href?: string }) {
    const content = (
        <>
            <span aria-hidden className="block h-[14px] w-[14px] flex-none bg-accent" />
            TaskMaster
        </>
    );

    return href ? (
        <Link href={href} className="nav-brand flex items-center gap-2 text-text no-underline">
            {content}
        </Link>
    ) : (
        <div className="nav-brand flex items-center gap-2">{content}</div>
    );
}
