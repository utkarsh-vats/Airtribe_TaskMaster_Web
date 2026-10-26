import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CollapsibleSection,
    resetSectionsForTests,
    sectionStorageKey,
} from '@/components/ui/CollapsibleSection';

const upload = vi.fn();

function renderSection(sectionKey = 'task-attachments') {
    return render(
        <CollapsibleSection
            sectionKey={sectionKey}
            title="Attachments"
            count={4}
            actions={<button onClick={upload}>Upload</button>}
        >
            <p>Section content</p>
        </CollapsibleSection>,
    );
}

const toggle = () => screen.getByRole('button', { name: /^Attachments/ });

beforeEach(() => {
    resetSectionsForTests();
    upload.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('CollapsibleSection', () => {
    it('open by default: the heading’s button (title, count, chevron) controls the content', () => {
        renderSection();

        expect(screen.getByRole('region', { name: 'Attachments' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 4 })).toContainElement(toggle());
        expect(toggle()).toHaveTextContent('Attachments4');
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        const content = document.getElementById(toggle().getAttribute('aria-controls') ?? '');
        expect(content).toContainElement(screen.getByText('Section content'));
        expect(screen.getByText('Section content')).toBeVisible();
    });

    it('the toggle hides and shows the content; the actions aren’t part of it', async () => {
        const u = userEvent.setup();
        renderSection();

        await u.click(screen.getByRole('button', { name: 'Upload' }));
        expect(upload).toHaveBeenCalledOnce();
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');

        await u.click(toggle());
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByText('Section content')).not.toBeVisible();
        // The actions stay usable while it's closed.
        expect(screen.getByRole('button', { name: 'Upload' })).toBeVisible();

        await u.click(toggle());
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Section content')).toBeVisible();
    });

    it('remembers closed per key across remounts and reloads (localStorage)', async () => {
        const u = userEvent.setup();
        const first = renderSection();
        await u.click(toggle());
        expect(localStorage.getItem(sectionStorageKey('task-attachments'))).toBe('false');
        first.unmount();

        const second = renderSection();
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        second.unmount();

        // A reload: nothing in memory, read back from storage. Other keys are independent.
        resetSectionsForTests();
        const again = renderSection();
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        again.unmount();
        renderSection('project-files');
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    });

    it('works when localStorage throws: open by default, toggling remembered for the page', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const u = userEvent.setup();
        const first = renderSection();
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');

        await u.click(toggle());
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        first.unmount();
        renderSection();
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });
});
