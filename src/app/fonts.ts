import { Archivo } from 'next/font/google';

// Variable font: covers the 400 / 600 / 800 weights the design system uses.
export const archivo = Archivo({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-archivo',
});
