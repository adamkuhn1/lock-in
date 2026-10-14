import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import { TodayIdeaCard } from './TodayIdea';

describe('TodayIdeaCard', () => {
  it("shows today's idea and marks it done", async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateIdea');
    renderWithData(<TodayIdeaCard />, { api });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Add Chicago to the city picker' }));
    expect(spy).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'done' }));
  });
});
