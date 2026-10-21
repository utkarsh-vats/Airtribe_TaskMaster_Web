import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

describe('Field', () => {
    it('associates the label with the control', () => {
        render(
            <Field label="Title">
                <Input />
            </Field>,
        );
        const input = screen.getByLabelText('Title');

        expect(input.tagName).toBe('INPUT');
        expect(input).not.toHaveAttribute('aria-invalid');
    });

    it('links the hint through aria-describedby', () => {
        render(
            <Field label="Title" hint="Up to 200 characters">
                <Input />
            </Field>,
        );

        expect(screen.getByLabelText('Title')).toHaveAccessibleDescription('Up to 200 characters');
    });

    it('sets aria-invalid and describes the control with the error', () => {
        render(
            <Field label="Password" hint="At least 8 characters" error="Too short">
                <Input type="password" />
            </Field>,
        );
        const input = screen.getByLabelText('Password');

        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAccessibleDescription('Too short At least 8 characters');
        const errorId = screen.getByText('Too short').id;
        expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(errorId);
    });

    it('marks the control required and works for other controls', () => {
        render(
            <Field label="Description" required>
                <Textarea />
            </Field>,
        );

        expect(screen.getByRole('textbox', { name: /Description/ })).toBeRequired();
    });
});
