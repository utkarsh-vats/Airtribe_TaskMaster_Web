import type { Metadata } from 'next';

import { SignedInAs } from './SignedInAs';

export const metadata: Metadata = { title: 'My tasks' };

// Placeholder — the task list comes in step 11.
export default function MyTasksPage() {
    return (
        <div className="flex flex-col gap-2">
            <h2 className="m-0">My tasks</h2>
            <SignedInAs />
        </div>
    );
}
