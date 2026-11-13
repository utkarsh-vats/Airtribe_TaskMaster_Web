'use client';

import { useSearchParams } from 'next/navigation';
import { MyTaskPanel } from './MyTaskPanel';
import { MyTasksListBody } from './MyTasksListBody';
import { useUrlWith } from '@/lib/hooks/useUrlWith';
import { parseTaskFilters } from '../filters';
import { useMyTasks } from '../api';

export function MyTasksView() {
    const searchParams = useSearchParams();
    const urlWith = useUrlWith();
    const filters = parseTaskFilters(searchParams);
    const tasks = useMyTasks(filters);
    const previousPage = filters.page - 1;
    const afterDeleteUrl =
        previousPage >= 1 && tasks.data?.items.length === 1
            ? urlWith({
                  task: null,
                  project: null,
                  page: previousPage > 1 ? String(previousPage) : null,
              })
            : undefined;
    return (
        <>
            <MyTasksListBody />
            <MyTaskPanel afterDeleteUrl={afterDeleteUrl} />
        </>
    );
}
