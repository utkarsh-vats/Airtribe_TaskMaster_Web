import Link from 'next/link';

type AuthSwitchProps = {
    current: 'login' | 'register';
    /** The page's `next` param, carried over so switching doesn't lose the destination. */
    next?: string | undefined;
};

const withNext = (path: string, next?: string) =>
    next ? `${path}?next=${encodeURIComponent(next)}` : path;

/** The prototype's "Sign in / Create account" segmented switch — two routes, not radio state. */
export function AuthSwitch({ current, next }: AuthSwitchProps) {
    return (
        <nav aria-label="Sign in or create an account" className="seg self-start">
            <Link
                href={withNext('/login', next)}
                className="seg-opt"
                aria-current={current === 'login' ? 'page' : undefined}
            >
                Sign in
            </Link>
            <Link
                href={withNext('/register', next)}
                className="seg-opt"
                aria-current={current === 'register' ? 'page' : undefined}
            >
                Create account
            </Link>
        </nav>
    );
}

export { withNext };
