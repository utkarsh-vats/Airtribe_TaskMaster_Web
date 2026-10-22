import Link from 'next/link';

import { RoleTag } from '@/components/ui/Tag';
import type { Project } from '@/lib/api/types';
import { relativeTime } from '@/lib/format/dates';

const members = (count: number) => (count === 1 ? '1 member' : `${count} members`);

/** "Updated yesterday" reads better than "Updated Yesterday". */
const updated = (iso: string) => {
    const when = relativeTime(iso);
    return `Updated ${when === 'Yesterday' ? 'yesterday' : when}`;
};

/** A project in the grid: the whole card links to its task list. */
export function ProjectCard({ project }: { project: Project }) {
    return (
        <Link
            href={`/dashboard/projects/${project.id}/tasks`}
            className="card elev-sm min-h-[148px] w-full text-text no-underline transition-shadow hover:text-text hover:shadow-md"
        >
            <span className="card-title break-words">{project.name}</span>
            {project.description ? (
                // card-body grows (flex: 1) to push the meta row down; the clamp sits inside it so the
                // extra height can't reveal a third line.
                <span className="card-body text-muted">
                    <span className="line-clamp-2">{project.description}</span>
                </span>
            ) : (
                <span aria-hidden className="flex-1" />
            )}
            <span className="card-meta flex-wrap">
                <RoleTag role={project.myRole} size="sm" />
                <span>{members(project.memberCount)}</span>
                <span aria-hidden>·</span>
                <span>{updated(project.updatedAt)}</span>
            </span>
        </Link>
    );
}
