'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type'>;

/** Password input with a show / hide toggle (aria-pressed = password visible). */
export function PasswordInput({ className, ...props }: PasswordInputProps) {
    const [visible, setVisible] = useState(false);

    return (
        <div className="relative">
            <Input
                {...props}
                type={visible ? 'text' : 'password'}
                className={className ? `pr-12 ${className}` : 'pr-12'}
            />
            <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label="Show password"
                aria-pressed={visible}
                onClick={() => setVisible((v) => !v)}
                className="absolute top-1 right-1 text-text"
            >
                {visible ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
            </Button>
        </div>
    );
}
