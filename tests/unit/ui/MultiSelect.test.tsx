import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { MultiSelect } from '@/components/ui/MultiSelect';
import { PRIORITY_LABELS, TASK_PRIORITIES, type TaskPriority } from '@/lib/domain';

const OPTIONS = TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }));

function Harness() {
    const [value, setValue] = useState<TaskPriority[]>([]);
    return <MultiSelect label="Priority" options={OPTIONS} value={value} onChange={setValue} />;
}

describe('MultiSelect', () => {
    it('summarises the selection as options are toggled and cleared', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'Any priority' });

        await user.click(trigger);
        await user.click(screen.getByRole('checkbox', { name: 'High' }));
        expect(trigger).toHaveTextContent('Priority: High');

        // Summary follows option order (Urgent → Low), not click order.
        await user.click(screen.getByRole('checkbox', { name: 'Urgent' }));
        expect(trigger).toHaveTextContent('Priority: Urgent, High');

        await user.click(screen.getByRole('checkbox', { name: 'High' }));
        expect(trigger).toHaveTextContent('Priority: Urgent');

        await user.click(screen.getByRole('button', { name: 'Clear' }));
        expect(trigger).toHaveTextContent('Any priority');
        expect(screen.getByRole('checkbox', { name: 'Urgent' })).not.toBeChecked();
    });
});
