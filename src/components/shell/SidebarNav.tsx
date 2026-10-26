'use client';

import { Bell, ListTodo, Mail, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, type ComponentType } from 'react';

import { ButtonLink } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { RoleTag } from '@/components/ui/Tag';
import { useMyInvitationsCount } from '@/features/invitations/api';
import { SIDEBAR_PROJECT_LIMIT, useProjects } from '@/features/projects/api';
import { errorMessage } from '@/lib/api/messages';
import { queryView } from '@/lib/query/view';

type SidebarNavProps = {
    /** Called when a link is followed (the drawer closes, even for the current page). */
    onNavigate?: () => void;
};

const isUnder = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * Navigation shared by the sidebar (820px and up) and the mobile drawer: personal links, the
 * projects list (prototype sidebar) and New project.
 */
export function SidebarNav({ onNavigate }: SidebarNavProps) {
    const pathname = usePathname();
    // Sidebar and drawer can both be mounted: keep the heading id unique.
    const projectsHeadingId = useId();

    return (
        <nav aria-label="Main" className="flex flex-col gap-6">
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
                <PersonalLink
                    href="/dashboard/my-tasks"
                    label="My tasks"
                    icon={ListTodo}
                    pathname={pathname}
                    onNavigate={onNavigate}
                />
                <InvitationsLink pathname={pathname} onNavigate={onNavigate} />
                <PersonalLink
                    href="/dashboard/notifications"
                    label="Notifications"
                    icon={Bell}
                    pathname={pathname}
                    onNavigate={onNavigate}
                />
            </ul>

            <section aria-labelledby={projectsHeadingId} className="flex flex-col gap-1">
                <h6 id={projectsHeadingId} className="text-muted m-0 mb-2">
                    Projects
                </h6>
                <ProjectList pathname={pathname} onNavigate={onNavigate} />
                <ButtonLink
                    href="/dashboard/projects?new=1"
                    variant="ghost"
                    className="mt-2 self-start"
                    onClick={onNavigate}
                >
                    <Plus aria-hidden size={14} />
                    New project
                </ButtonLink>
            </section>
        </nav>
    );
}

type LinkProps = {
    pathname: string;
    onNavigate: (() => void) | undefined;
};

function PersonalLink({
    href,
    label,
    icon: Icon,
    pathname,
    onNavigate,
    badge,
}: LinkProps & {
    href: string;
    label: string;
    icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
    badge?: { count: number; srLabel: string };
}) {
    return (
        <li>
            <Link
                href={href}
                className="tm-nav-link"
                aria-current={isUnder(pathname, href) ? 'page' : undefined}
                onClick={onNavigate}
            >
                <Icon aria-hidden size={16} />
                <span className="min-w-0 truncate">{label}</span>
                {badge && badge.count > 0 && (
                    <>
                        <span
                            aria-hidden
                            className="tm-count-badge"
                            data-testid="invitations-badge"
                        >
                            {badge.count > 9 ? '9+' : badge.count}
                        </span>
                        <span className="sr-only">{badge.srLabel}</span>
                    </>
                )}
            </Link>
        </li>
    );
}

function InvitationsLink(props: LinkProps) {
    const { data: pending = 0 } = useMyInvitationsCount();
    return (
        <PersonalLink
            {...props}
            href="/dashboard/invitations"
            label="Invitations"
            icon={Mail}
            badge={{ count: pending, srLabel: `, ${pending} pending` }}
        />
    );
}

function ProjectList({ pathname, onNavigate }: LinkProps) {
    const projects = useProjects();
    const view = queryView(projects);

    if (view.status === 'loading') {
        return (
            <div aria-busy="true" className="flex flex-col gap-3 px-[10px] py-2">
                <span className="sr-only">Loading projects…</span>
                <Skeleton width="80%" />
                <Skeleton width="60%" />
                <Skeleton width="70%" />
            </div>
        );
    }

    if (view.status === 'error') {
        return (
            <ErrorState
                compact
                title="Couldn't load projects"
                message={errorMessage(view.error)}
                retrying={projects.isRefetching}
                onRetry={() => void projects.refetch()}
                className="px-[10px]"
            />
        );
    }

    const { items, meta } = view.data;
    if (items.length === 0) {
        return <p className="text-muted m-0 px-[10px] py-2 text-sm">No projects yet</p>;
    }

    return (
        <>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {items.map((project) => {
                    const href = `/dashboard/projects/${project.id}`;
                    return (
                        <li key={project.id}>
                            <Link
                                href={href}
                                title={project.name}
                                className="tm-nav-link"
                                aria-current={isUnder(pathname, href) ? 'page' : undefined}
                                onClick={onNavigate}
                            >
                                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                                <RoleTag role={project.myRole} size="sm" className="flex-none" />
                            </Link>
                        </li>
                    );
                })}
            </ul>
            {meta.total > SIDEBAR_PROJECT_LIMIT && (
                <Link
                    href="/dashboard/projects"
                    className="px-[10px] py-1 text-sm"
                    onClick={onNavigate}
                >
                    View all projects ({meta.total})
                </Link>
            )}
        </>
    );
}
