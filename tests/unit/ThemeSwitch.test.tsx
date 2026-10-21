import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import { describe, expect, it } from 'vitest';

import { ThemeSwitch } from '@/components/shell/ThemeSwitch';

function renderSwitch() {
    return render(
        <ThemeProvider attribute="data-theme" themes={['light', 'dark']} defaultTheme="system">
            <ThemeSwitch />
        </ThemeProvider>,
    );
}

describe('ThemeSwitch', () => {
    it('is an accessible switch that starts off under a light system theme', () => {
        renderSwitch();

        const toggle = screen.getByRole('switch', { name: 'Dark theme' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    });

    it('toggles between dark and light', async () => {
        const user = userEvent.setup();
        renderSwitch();
        const toggle = screen.getByRole('switch', { name: 'Dark theme' });

        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
        expect(localStorage.getItem('theme')).toBe('dark');

        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    });
});
