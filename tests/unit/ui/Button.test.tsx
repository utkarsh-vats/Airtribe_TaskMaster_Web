import { render, screen } from '@testing-library/react';
import { Pencil } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui/Button';

describe('Button', () => {
    it('is enabled and not busy by default', () => {
        render(<Button>Save</Button>);
        const button = screen.getByRole('button', { name: 'Save' });

        expect(button).toBeEnabled();
        expect(button).not.toHaveAttribute('aria-busy');
        expect(button).toHaveAttribute('type', 'button');
    });

    it('loading disables the button and sets aria-busy', () => {
        render(
            <Button variant="primary" loading>
                Save
            </Button>,
        );
        const button = screen.getByRole('button', { name: 'Save' });

        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');
    });

    it('iconOnly renders the aria-label as its accessible name', () => {
        render(
            <Button iconOnly aria-label="Edit task">
                <Pencil aria-hidden />
            </Button>,
        );
        const button = screen.getByRole('button', { name: 'Edit task' });

        expect(button).toHaveAttribute('aria-label', 'Edit task');
        expect(button).toHaveClass('btn-icon');
    });

    it('requires aria-label for iconOnly at the type level', () => {
        // @ts-expect-error — iconOnly without aria-label must not type-check.
        const element = <Button iconOnly>x</Button>;
        expect(element).toBeTruthy();
    });
});
