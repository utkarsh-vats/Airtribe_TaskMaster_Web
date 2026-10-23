'use client';

import { ChevronDown, LogOut, MonitorSmartphone, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    Menu,
    MenuContent,
    MenuItem,
    MenuLabel,
    MenuSeparator,
    MenuTrigger,
} from '@/components/ui/Menu';
import { signOut, signOutEverywhere } from '@/lib/auth/actions';
import { useSession } from '@/lib/auth/SessionProvider';

/**
 * Header profile menu: avatar + first name (avatar only below 480px); Profile, Sign out, Sign
 * out of all devices.
 */
export function ProfileMenu() {
    const { user } = useSession();
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    if (!user) return null;
    const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;
    // Client-side navigation keeps the root layout (and its toasts) on screen.
    const navigate = (path: string) => router.replace(path);

    return (
        <>
            <Menu>
                <MenuTrigger asChild>
                    <Button
                        variant="secondary"
                        aria-label={`Account menu for ${user.name}`}
                        className="gap-2 py-1 pr-2 pl-1"
                    >
                        <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                        <span className="hidden min-[480px]:inline">{firstName}</span>
                        <ChevronDown aria-hidden size={14} />
                    </Button>
                </MenuTrigger>
                <MenuContent>
                    <MenuLabel className="truncate tracking-normal normal-case">
                        {user.email}
                    </MenuLabel>
                    <MenuItem asChild>
                        <Link href="/dashboard/profile" className="text-text no-underline">
                            <UserRound aria-hidden size={14} />
                            Profile
                        </Link>
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                        disabled={pending}
                        onSelect={() => {
                            setPending(true);
                            void signOut({ navigate });
                        }}
                    >
                        <LogOut aria-hidden size={14} />
                        Sign out
                    </MenuItem>
                    <MenuItem disabled={pending} danger onSelect={() => setConfirmOpen(true)}>
                        <MonitorSmartphone aria-hidden size={14} />
                        Sign out of all devices
                    </MenuItem>
                </MenuContent>
            </Menu>

            <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title="Sign out of all devices?"
                description="You'll be signed out here and on every other device or browser."
                confirmLabel="Sign out everywhere"
                destructive
                onConfirm={async () => {
                    setPending(true);
                    const result = await signOutEverywhere({ navigate });
                    if (result === 'failed') {
                        setPending(false);
                        // Keep the dialog open so the user can retry; the error is toasted.
                        throw new Error('Sign out everywhere failed');
                    }
                }}
            />
        </>
    );
}
