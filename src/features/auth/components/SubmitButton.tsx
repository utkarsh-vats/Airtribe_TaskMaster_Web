import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

/**
 * The prototype's full-width primary submit: label flush left, arrow on the right. While
 * pending the arrow becomes a spinner and the button is disabled + aria-busy.
 */
export function SubmitButton({ pending, children }: { pending: boolean; children: string }) {
    return (
        <Button
            type="submit"
            variant="primary"
            block
            disabled={pending}
            aria-busy={pending || undefined}
            className="justify-between px-[14px] py-3"
        >
            {children}
            {pending ? <Spinner size={16} /> : <ArrowRight aria-hidden size={16} />}
        </Button>
    );
}
