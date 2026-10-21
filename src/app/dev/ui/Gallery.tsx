'use client';

import { Ellipsis, Info, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { BrandMark } from '@/components/shell/BrandMark';
import { ThemeSwitch } from '@/components/shell/ThemeSwitch';
import { Avatar } from '@/components/ui/Avatar';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardKicker, CardMeta, CardTitle } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/ui/Field';
import { DateField, Input, NativeSelect } from '@/components/ui/Input';
import { LinkTabs } from '@/components/ui/LinkTabs';
import {
    Menu,
    MenuContent,
    MenuItem,
    MenuLabel,
    MenuSeparator,
    MenuTrigger,
} from '@/components/ui/Menu';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Pagination } from '@/components/ui/Pagination';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import { Drawer, Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableEmpty, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/Table';
import { PriorityMark, RoleTag, StatusTag, Tag } from '@/components/ui/Tag';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toaster';
import { Tooltip } from '@/components/ui/Tooltip';
import {
    PRIORITY_LABELS,
    PROJECT_ROLES,
    STATUS_LABELS,
    TASK_PRIORITIES,
    TASK_STATUSES,
    type TaskPriority,
    type TaskStatus,
} from '@/lib/domain';

type StatusFilter = 'ALL' | TaskStatus;

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }));
const STATUS_OPTIONS = TASK_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));

const ROWS: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    assignee: string;
    due: string;
}[] = [
    {
        id: '1',
        title: 'Finalise homepage hero copy',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assignee: 'Mara Okafor',
        due: 'Oct 23',
    },
    {
        id: '2',
        title: 'Migrate blog posts to new CMS',
        status: 'OPEN',
        priority: 'MEDIUM',
        assignee: 'Priya Raman',
        due: 'Oct 28',
    },
    {
        id: '3',
        title: 'Set up 301 redirects',
        status: 'OPEN',
        priority: 'URGENT',
        assignee: 'Jonas Weber',
        due: 'Oct 18',
    },
    {
        id: '4',
        title: 'Cookie consent banner',
        status: 'COMPLETED',
        priority: 'LOW',
        assignee: 'Tom Lee',
        due: 'Oct 14',
    },
];

// A tiny inline image so the Avatar's image path can be seen without a network request.
const AVATAR_IMAGE =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0f8a80"/><circle cx="16" cy="13" r="6" fill="#e9f7f5"/><rect x="6" y="22" width="20" height="10" fill="#e9f7f5"/></svg>',
    );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-4 border-t-rule border-divider pt-4">
            <h4 className="m-0">{title}</h4>
            {children}
        </section>
    );
}

function Demo({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <h6 className="text-muted m-0">{label}</h6>
            {children}
        </div>
    );
}

const grid = 'grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3';
const row = 'flex flex-wrap items-center gap-2';

export function Gallery() {
    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [priorities, setPriorities] = useState<TaskPriority[]>(['URGENT', 'HIGH']);
    const [statuses, setStatuses] = useState<TaskStatus[]>([]);
    const [description, setDescription] = useState('Grows as you type.\nTry adding a few lines.');
    const [page, setPage] = useState(2);
    const [tableLoading, setTableLoading] = useState(false);
    const [retrying, setRetrying] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);

    return (
        <div className="flex min-h-screen flex-col">
            <header className="nav sticky top-0 z-30 gap-3 bg-bg">
                <BrandMark href="/dev/ui" />
                <span className="text-muted hidden text-sm sm:inline">UI kit</span>
                <ThemeSwitch />
            </header>

            <main className="flex w-full max-w-[1100px] flex-col gap-8 p-4 md:p-6">
                <div>
                    <div className="card-kicker text-accent-700">Dev</div>
                    <h2 className="m-0">UI kit</h2>
                    <p className="text-muted mt-2 mb-0 max-w-[70ch]">
                        Every component in src/components/ui in its variants and states. Use the
                        switch above for the dark theme. Not available in production builds.
                    </p>
                </div>

                <Section title="Type">
                    <div className="flex flex-col gap-1">
                        <h1 className="m-0">Heading 1 · 42</h1>
                        <h2 className="m-0">Heading 2 · 32</h2>
                        <h3 className="m-0">Heading 3 · 25</h3>
                        <h4 className="m-0">Heading 4 · 20</h4>
                        <h5 className="m-0">Heading 5 · 16</h5>
                        <h6 className="m-0">Heading 6 · 13</h6>
                        <p className="m-0">
                            Body 15 / 1.55. <a href="#links">A link in body text.</a>
                        </p>
                    </div>
                </Section>

                <Section title="Buttons">
                    <div className={grid}>
                        <Demo label="Variants">
                            <div className={row}>
                                <Button variant="primary">Primary</Button>
                                <Button variant="secondary">Secondary</Button>
                                <Button variant="ghost">Ghost</Button>
                            </div>
                        </Demo>
                        <Demo label="Small">
                            <div className={row}>
                                <Button variant="primary" size="sm">
                                    Primary
                                </Button>
                                <Button variant="secondary" size="sm">
                                    Secondary
                                </Button>
                                <Button variant="ghost" size="sm">
                                    Ghost
                                </Button>
                            </div>
                        </Demo>
                        <Demo label="With icon">
                            <div className={row}>
                                <Button variant="primary">
                                    <Plus aria-hidden size={14} />
                                    New task
                                </Button>
                                <Button variant="ghost">
                                    <Plus aria-hidden size={14} />
                                    New project
                                </Button>
                            </div>
                        </Demo>
                        <Demo label="Icon only">
                            <div className={row}>
                                <Button iconOnly aria-label="Edit">
                                    <Pencil aria-hidden size={16} />
                                </Button>
                                <Button iconOnly variant="secondary" aria-label="Invite">
                                    <UserPlus aria-hidden size={16} />
                                </Button>
                                <Button iconOnly size="sm" variant="secondary" aria-label="More">
                                    <Ellipsis aria-hidden size={14} />
                                </Button>
                            </div>
                        </Demo>
                        <Demo label="Loading">
                            <div className={row}>
                                <Button variant="primary" loading>
                                    Saving
                                </Button>
                                <Button variant="secondary" loading>
                                    Loading
                                </Button>
                                <Button iconOnly variant="secondary" loading aria-label="Refresh">
                                    <Plus aria-hidden size={16} />
                                </Button>
                            </div>
                        </Demo>
                        <Demo label="Disabled">
                            <div className={row}>
                                <Button variant="primary" disabled>
                                    Primary
                                </Button>
                                <Button variant="secondary" disabled>
                                    Secondary
                                </Button>
                                <Button variant="ghost" disabled>
                                    Ghost
                                </Button>
                            </div>
                        </Demo>
                        <Demo label="Danger">
                            <div className={row}>
                                <Button variant="primary" danger>
                                    Delete project
                                </Button>
                                <Button variant="secondary" danger>
                                    Leave project
                                </Button>
                                <Button variant="ghost" danger>
                                    <Trash2 aria-hidden size={14} />
                                    Delete task
                                </Button>
                            </div>
                        </Demo>
                        <Demo label="Block (label flush left)">
                            <Button variant="primary" block>
                                Sign in
                            </Button>
                        </Demo>
                        <Demo label="ButtonLink">
                            <div className={row}>
                                <ButtonLink href="/register" variant="primary">
                                    Create account
                                </ButtonLink>
                                <ButtonLink href="/login" variant="ghost">
                                    Sign in
                                </ButtonLink>
                                <ButtonLink href="/" variant="secondary">
                                    Home
                                </ButtonLink>
                            </div>
                        </Demo>
                        <Demo label="Spinner">
                            <div className={row}>
                                <Spinner />
                                <Spinner size={24} label="Loading tasks" />
                            </div>
                        </Demo>
                    </div>
                </Section>

                <Section title="Tags">
                    <div className={grid}>
                        <Demo label="Tones">
                            <div className={row}>
                                <Tag tone="neutral">Neutral</Tag>
                                <Tag tone="accent">Accent</Tag>
                                <Tag tone="outline">Outline</Tag>
                            </div>
                        </Demo>
                        <Demo label="Status">
                            <div className={row}>
                                {TASK_STATUSES.map((s) => (
                                    <StatusTag key={s} status={s} />
                                ))}
                            </div>
                        </Demo>
                        <Demo label="Role">
                            <div className={row}>
                                {PROJECT_ROLES.map((r) => (
                                    <RoleTag key={r} role={r} />
                                ))}
                            </div>
                        </Demo>
                        <Demo label="Priority">
                            <div className="flex flex-wrap gap-4">
                                {TASK_PRIORITIES.map((p) => (
                                    <PriorityMark key={p} priority={p} />
                                ))}
                            </div>
                        </Demo>
                    </div>
                </Section>

                <Section title="Fields">
                    <div className={grid}>
                        <Field label="Title" hint="Up to 200 characters.">
                            <Input placeholder="What needs doing?" />
                        </Field>
                        <Field label="Email" required>
                            <Input type="email" placeholder="you@company.com" />
                        </Field>
                        <Field label="Password" error="At least 8 characters">
                            <Input type="password" defaultValue="short" />
                        </Field>
                        <Field label="Email (read-only)">
                            <Input defaultValue="mara@taskmaster.app" disabled />
                        </Field>
                        <Field label="Priority">
                            <NativeSelect defaultValue="HIGH">
                                {TASK_PRIORITIES.map((p) => (
                                    <option key={p} value={p}>
                                        {PRIORITY_LABELS[p]}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Due date" hint="Due at the end of the day.">
                            <DateField defaultValue="2026-10-28" />
                        </Field>
                        <Field label="Description">
                            <Textarea placeholder="Details, links, acceptance criteria" />
                        </Field>
                        <Field label="Description (auto-grow)">
                            <Textarea
                                autoGrow
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </Field>
                        <Field label="Comment" error="Comment can't be empty">
                            <Textarea />
                        </Field>
                    </div>
                </Section>

                <Section title="Choice">
                    <div className={grid}>
                        <Demo label="Segmented (arrow keys move)">
                            <div className="overflow-x-auto">
                                <Segmented<StatusFilter>
                                    aria-label="Status"
                                    value={status}
                                    onChange={setStatus}
                                    options={[
                                        { value: 'ALL', label: 'All', count: 8 },
                                        { value: 'OPEN', label: 'To do', count: 4 },
                                        { value: 'IN_PROGRESS', label: 'In progress', count: 2 },
                                        { value: 'COMPLETED', label: 'Done', count: 2 },
                                    ]}
                                />
                            </div>
                            <div className="text-muted text-xs">Value: {status}</div>
                        </Demo>
                        <Demo label="MultiSelect">
                            <div className={row}>
                                <MultiSelect
                                    label="Priority"
                                    options={PRIORITY_OPTIONS}
                                    value={priorities}
                                    onChange={setPriorities}
                                />
                                <MultiSelect
                                    label="Status"
                                    options={STATUS_OPTIONS}
                                    value={statuses}
                                    onChange={setStatuses}
                                />
                            </div>
                        </Demo>
                    </div>
                </Section>

                <Section title="Cards">
                    <div className={grid}>
                        <Card>
                            <CardKicker>Project</CardKicker>
                            <CardTitle>Website relaunch</CardTitle>
                            <CardBody>
                                New marketing site and docs, live before the November launch.
                            </CardBody>
                            <CardMeta>
                                <RoleTag role="OWNER" /> 4 members
                            </CardMeta>
                        </Card>
                        <Card elevation="sm">
                            <div className="flex items-center gap-2">
                                <PriorityMark priority="HIGH" className="text-xs" />
                            </div>
                            <CardTitle className="text-[15px]">
                                Finalise homepage hero copy
                            </CardTitle>
                            <CardMeta className="justify-between">
                                Oct 23 <Avatar name="Mara Okafor" size="sm" />
                            </CardMeta>
                        </Card>
                        <Card elevation="lg">
                            <CardTitle>Elevation lg</CardTitle>
                            <CardBody>For floating surfaces.</CardBody>
                        </Card>
                    </div>
                </Section>

                <Section title="Table">
                    <div className={row}>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setTableLoading((v) => !v)}
                        >
                            {tableLoading ? 'Show rows' : 'Show skeleton'}
                        </Button>
                        <span className="text-muted text-xs">Rows open on click or Enter.</span>
                    </div>
                    <Table minWidth={640}>
                        <THead>
                            <tr>
                                <Th>Task</Th>
                                <Th className="w-[130px]">Status</Th>
                                <Th className="w-[110px]">Priority</Th>
                                <Th className="w-[170px]">Assignee</Th>
                                <Th className="w-[80px]">Due</Th>
                            </tr>
                        </THead>
                        {tableLoading ? (
                            <TableSkeleton rows={4} cols={5} />
                        ) : (
                            <TBody>
                                {ROWS.map((r) => (
                                    <Tr key={r.id} onOpen={() => toast(`Open “${r.title}”`)}>
                                        <Td className="font-semibold">{r.title}</Td>
                                        <Td>
                                            <StatusTag status={r.status} />
                                        </Td>
                                        <Td>
                                            <PriorityMark priority={r.priority} />
                                        </Td>
                                        <Td>
                                            <span className="flex items-center gap-[6px] text-sm">
                                                <Avatar name={r.assignee} size="sm" />
                                                {r.assignee}
                                            </span>
                                        </Td>
                                        <Td
                                            className={
                                                r.priority === 'URGENT'
                                                    ? 'font-bold text-danger'
                                                    : undefined
                                            }
                                        >
                                            {r.due}
                                        </Td>
                                    </Tr>
                                ))}
                            </TBody>
                        )}
                    </Table>
                    <Demo label="Empty table">
                        <Table>
                            <THead>
                                <tr>
                                    <Th>Email</Th>
                                    <Th>Role</Th>
                                </tr>
                            </THead>
                            <TableEmpty colSpan={2} title="No pending invitations">
                                Invite someone above.
                            </TableEmpty>
                        </Table>
                    </Demo>
                </Section>

                <Section title="Overlays">
                    <div className={row}>
                        <Dialog
                            trigger={
                                <Button variant="primary">
                                    <Plus aria-hidden size={14} />
                                    New task
                                </Button>
                            }
                            title="New task"
                            width={580}
                            actions={
                                <>
                                    <DialogClose asChild>
                                        <Button variant="secondary">Cancel</Button>
                                    </DialogClose>
                                    <DialogClose asChild>
                                        <Button
                                            variant="primary"
                                            onClick={() => toast.success('Task created')}
                                        >
                                            Create task
                                        </Button>
                                    </DialogClose>
                                </>
                            }
                        >
                            <Field label="Title" required>
                                <Input placeholder="What needs doing?" />
                            </Field>
                            <Field label="Description">
                                <Textarea autoGrow />
                            </Field>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Field label="Priority">
                                    <NativeSelect defaultValue="MEDIUM">
                                        {TASK_PRIORITIES.map((p) => (
                                            <option key={p} value={p}>
                                                {PRIORITY_LABELS[p]}
                                            </option>
                                        ))}
                                    </NativeSelect>
                                </Field>
                                <Field label="Due date">
                                    <DateField />
                                </Field>
                            </div>
                        </Dialog>
                        <Dialog
                            trigger={<Button variant="secondary">Dialog with description</Button>}
                            title="Transfer ownership?"
                            description="You'll become an admin. Priya becomes the owner and can remove you."
                            actions={
                                <>
                                    <DialogClose asChild>
                                        <Button variant="secondary">Cancel</Button>
                                    </DialogClose>
                                    <DialogClose asChild>
                                        <Button variant="primary">Transfer</Button>
                                    </DialogClose>
                                </>
                            }
                        />
                        <ConfirmDialog
                            trigger={<Button variant="secondary">Confirm</Button>}
                            title="Leave “Website relaunch”?"
                            description="Your assigned tasks become unassigned."
                            confirmLabel="Leave project"
                            destructive
                            onConfirm={async () => {
                                await sleep(800);
                                toast('You left the project');
                            }}
                        />
                        <ConfirmDialog
                            trigger={
                                <Button variant="secondary" danger>
                                    Type-to-confirm
                                </Button>
                            }
                            title="Delete “Website relaunch”?"
                            description="This permanently removes 8 tasks, their comments and all pending invitations."
                            confirmLabel="Delete project"
                            confirmText="Website relaunch"
                            destructive
                            onConfirm={() => {
                                toast.success('Project deleted');
                            }}
                        />
                        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
                            Sheet
                        </Button>
                        <Drawer
                            trigger={<Button variant="secondary">Drawer</Button>}
                            title="Navigation"
                        >
                            <h6 className="text-muted m-0">Projects</h6>
                            <nav className="flex flex-col gap-1">
                                {['Website relaunch', 'Mobile app v2', 'Q4 hiring'].map((name) => (
                                    <a
                                        key={name}
                                        href="#drawer"
                                        className="px-2 py-2 text-text no-underline hover:bg-surface"
                                    >
                                        {name}
                                    </a>
                                ))}
                            </nav>
                        </Drawer>
                    </div>
                    <Sheet
                        open={sheetOpen}
                        onOpenChange={setSheetOpen}
                        title="Website relaunch / Finalise homepage hero copy"
                        footer={
                            <>
                                <span className="text-muted mr-auto text-xs">
                                    Created by Mara Okafor · Oct 12
                                </span>
                                <Button variant="ghost" danger>
                                    <Trash2 aria-hidden size={14} />
                                    Delete task
                                </Button>
                            </>
                        }
                    >
                        <Textarea
                            autoGrow
                            aria-label="Title"
                            rows={1}
                            defaultValue="Finalise homepage hero copy"
                            className="min-h-0 border-0 bg-transparent p-0 font-heading text-[26px] leading-[1.15] font-extrabold"
                        />
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Status">
                                <NativeSelect defaultValue="IN_PROGRESS">
                                    {TASK_STATUSES.map((s) => (
                                        <option key={s} value={s}>
                                            {STATUS_LABELS[s]}
                                        </option>
                                    ))}
                                </NativeSelect>
                            </Field>
                            <Field label="Priority">
                                <NativeSelect defaultValue="HIGH">
                                    {TASK_PRIORITIES.map((p) => (
                                        <option key={p} value={p}>
                                            {PRIORITY_LABELS[p]}
                                        </option>
                                    ))}
                                </NativeSelect>
                            </Field>
                            <Field label="Assignee">
                                <NativeSelect defaultValue="mara">
                                    <option value="">Unassigned</option>
                                    <option value="mara">Mara Okafor</option>
                                </NativeSelect>
                            </Field>
                            <Field label="Due date">
                                <DateField defaultValue="2026-10-23" />
                            </Field>
                        </div>
                        <Field label="Description">
                            <Textarea
                                autoGrow
                                defaultValue="Tighten the headline to under eight words and align it with the launch messaging doc."
                            />
                        </Field>
                    </Sheet>

                    <div className={grid}>
                        <Demo label="Menu">
                            <Menu>
                                <MenuTrigger asChild>
                                    <Button
                                        variant="secondary"
                                        iconOnly
                                        aria-label="Member actions"
                                    >
                                        <Ellipsis aria-hidden size={16} />
                                    </Button>
                                </MenuTrigger>
                                <MenuContent align="start">
                                    <MenuLabel>Priya Raman</MenuLabel>
                                    <MenuItem onSelect={() => toast('Made admin')}>
                                        Make admin
                                    </MenuItem>
                                    <MenuItem onSelect={() => toast('Ownership transfer')}>
                                        Transfer ownership
                                    </MenuItem>
                                    <MenuItem disabled>Change email</MenuItem>
                                    <MenuSeparator />
                                    <MenuItem danger onSelect={() => toast('Removed')}>
                                        <Trash2 aria-hidden size={14} />
                                        Remove
                                    </MenuItem>
                                </MenuContent>
                            </Menu>
                        </Demo>
                        <Demo label="Popover">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="secondary">Open popover</Button>
                                </PopoverTrigger>
                                <PopoverContent className="flex w-[280px] flex-col gap-2">
                                    <div className="font-heading font-extrabold">Notifications</div>
                                    <p className="text-muted m-0 text-sm">
                                        Any content: a panel, a form, a list.
                                    </p>
                                    <PopoverClose asChild>
                                        <Button variant="ghost" size="sm" className="self-start">
                                            Close
                                        </Button>
                                    </PopoverClose>
                                </PopoverContent>
                            </Popover>
                        </Demo>
                        <Demo label="Tooltip">
                            <div className={row}>
                                <Tooltip content="Only owners can delete a project">
                                    <Button
                                        variant="secondary"
                                        iconOnly
                                        aria-label="About deleting"
                                    >
                                        <Info aria-hidden size={16} />
                                    </Button>
                                </Tooltip>
                                <Tooltip content="Members can delete only tasks they created.">
                                    <span tabIndex={0} className="inline-flex">
                                        <Button variant="ghost" danger disabled>
                                            Delete task
                                        </Button>
                                    </span>
                                </Tooltip>
                            </div>
                        </Demo>
                        <Demo label="Toasts">
                            <div className={row}>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => toast('Invitation sent to ana@company.com')}
                                >
                                    Default
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => toast.success('Task created')}
                                >
                                    Success
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                        toast.error("You don't have permission to do that")
                                    }
                                >
                                    Error
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                        toast.error('Couldn’t reach the server', {
                                            description: 'Check your connection.',
                                            action: {
                                                label: 'Retry',
                                                onClick: () => toast('Retrying…'),
                                            },
                                        })
                                    }
                                >
                                    With action
                                </Button>
                            </div>
                        </Demo>
                    </div>
                </Section>

                <Section title="Navigation">
                    <Demo label="LinkTabs (route tabs)">
                        <LinkTabs
                            aria-label="Project"
                            currentPath="/dashboard/projects/p1/tasks"
                            tabs={[
                                { href: '/dashboard/projects/p1/tasks', label: 'Tasks' },
                                { href: '/dashboard/projects/p1/discussion', label: 'Discussion' },
                                { href: '/dashboard/projects/p1/files', label: 'Files' },
                                { href: '/dashboard/projects/p1/members', label: 'Members' },
                                { href: '/dashboard/projects/p1/settings', label: 'Settings' },
                            ]}
                        />
                    </Demo>
                    <Demo label="Pagination">
                        <Pagination page={page} totalPages={5} onPageChange={setPage} />
                    </Demo>
                </Section>

                <Section title="Avatars">
                    <div className={row}>
                        <Avatar name="Mara Okafor" size="sm" />
                        <Avatar name="Mara Okafor" />
                        <Avatar name="Cher" />
                        <Avatar name="Image Avatar" src={AVATAR_IMAGE} />
                        <Avatar name="Broken Image" src="/missing-avatar.png" />
                    </div>
                </Section>

                <Section title="States">
                    <div className={grid}>
                        <Demo label="Skeleton">
                            <div aria-busy="true" className="flex flex-col gap-2">
                                <Skeleton width="70%" />
                                <Skeleton />
                                <Skeleton width="40%" />
                            </div>
                        </Demo>
                        <EmptyState
                            title="No tasks match"
                            body="Clear the search or pick another status."
                            action={<Button variant="secondary">Clear filters</Button>}
                        />
                        <ErrorState
                            message="We couldn't load the tasks."
                            retrying={retrying}
                            onRetry={() => {
                                setRetrying(true);
                                setTimeout(() => setRetrying(false), 1200);
                            }}
                        />
                    </div>
                </Section>
            </main>
        </div>
    );
}
