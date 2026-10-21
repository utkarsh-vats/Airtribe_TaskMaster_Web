import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Segmented } from '@/components/ui/Segmented';

type View = 'list' | 'board';

function Harness({ onChange }: { onChange: (value: View) => void }) {
    const [value, setValue] = useState<View>('list');
    return (
        <Segmented<View>
            aria-label="View"
            value={value}
            onChange={(next) => {
                setValue(next);
                onChange(next);
            }}
            options={[
                { value: 'list', label: 'List', count: 3 },
                { value: 'board', label: 'Board' },
            ]}
        />
    );
}

describe('Segmented', () => {
    it('calls onChange with the selected option value', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);

        expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /List/ })).toBeChecked();

        await user.click(screen.getByRole('radio', { name: 'Board' }));

        expect(onChange).toHaveBeenCalledWith('board');
        expect(screen.getByRole('radio', { name: 'Board' })).toBeChecked();
    });
});
