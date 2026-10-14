import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import { ProjectsList } from './Projects';

describe('ProjectsList', () => {
  it('one card per active project, first is primary, strip and last commit', async () => {
    const { container } = renderWithData(<ProjectsList />);
    expect(await screen.findByRole('heading', { level: 2, name: '27B' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Showboat' })).toBeInTheDocument();
    expect(container.querySelector('[data-primary]')).toHaveTextContent('27B');
    expect(screen.getAllByRole('img', { name: /Commits on \d+ of the last 30 days/ })).toHaveLength(3);
    expect(await screen.findByText(/Add city search/)).toBeInTheDocument();
  });
  it('reorders, completes and drops ideas', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateIdea');
    renderWithData(<ProjectsList />, { api });
    // Up, Down and Drop live behind each row's "More" menu.
    await userEvent.click(await screen.findByLabelText('More: Add Chicago to the city picker'));
    await userEvent.click(screen.getByRole('button', { name: 'Move down: Add Chicago to the city picker' }));
    expect(spy).toHaveBeenCalledWith('i2', { position: 0 });
    expect(spy).toHaveBeenCalledWith('i1', { position: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Done: Cache weather API responses' }));
    expect(spy).toHaveBeenCalledWith('i2', expect.objectContaining({ status: 'done' }));
    await userEvent.click(screen.getByLabelText('More: Offline mode for saved trips'));
    await userEvent.click(screen.getByRole('button', { name: 'Drop: Offline mode for saved trips' }));
    expect(spy).toHaveBeenCalledWith('i4', { status: 'dropped' });
  });
  it('adds an idea at the end of the list', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'addIdea');
    renderWithData(<ProjectsList />, { api });
    const input = await screen.findByRole('textbox', { name: 'New idea for 27B' });
    await userEvent.type(input, 'Add dark mode{Enter}');
    expect(spy).toHaveBeenCalledWith({ project_id: '27b', text: 'Add dark mode', size: 'S', position: 4 });
  });
  it('Suggest improvements queues a Mac launch', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'requestLaunch');
    renderWithData(<ProjectsList />, { api });
    const card = (await screen.findByRole('heading', { level: 2, name: 'Showboat' })).closest('section')!;
    await userEvent.click(within(card).getByRole('button', { name: 'Suggest improvements' }));
    expect(spy).toHaveBeenCalledWith('suggest_ideas', { project_id: 'showboat' });
    expect(await within(card).findByRole('button', { name: 'Queued for Mac' })).toBeDisabled();
  });
  it('shows Opened on Mac, and a failed launch offers Try again (a new request)', async () => {
    const api = createDemoApi();
    api.listLaunchRequests = async () => [
      { id: 'a', kind: 'suggest_ideas', payload: { project_id: '27b' }, status: 'launched', error: null, created_at: new Date(Date.now() - 5 * 60_000).toISOString() },
      { id: 'b', kind: 'suggest_ideas', payload: { project_id: 'showboat' }, status: 'failed', error: "LaunchError: /Users/adamk/Developer/showboat doesn't exist on this Mac", created_at: '2026-10-14T12:00:00Z' },
    ];
    const spy = vi.spyOn(api, 'requestLaunch');
    renderWithData(<ProjectsList />, { api });
    const b27 = (await screen.findByRole('heading', { level: 2, name: '27B' })).closest('section')!;
    expect(await within(b27).findByText('Opened on Mac')).toBeInTheDocument();
    const show = screen.getByRole('heading', { level: 2, name: 'Showboat' }).closest('section')!;
    expect(within(show).getByText(/doesn't exist on this Mac/)).toBeInTheDocument();
    await userEvent.click(within(show).getByRole('button', { name: 'Try again' }));
    expect(spy).toHaveBeenCalledWith('suggest_ideas', { project_id: 'showboat' });
  });
  it('an Opened on Mac older than an hour goes back to idle (M12)', async () => {
    const api = createDemoApi();
    api.listLaunchRequests = async () => [
      { id: 'a', kind: 'suggest_ideas', payload: { project_id: '27b' }, status: 'launched', error: null, created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() },
    ];
    renderWithData(<ProjectsList />, { api });
    const b27 = (await screen.findByRole('heading', { level: 2, name: '27B' })).closest('section')!;
    expect(await within(b27).findByRole('button', { name: 'Suggest improvements' })).toBeEnabled();
    expect(within(b27).queryByText('Opened on Mac')).toBeNull();
  });
  it('a project without commits says No commits yet (M11)', async () => {
    const api = createDemoApi();
    api.listCommits = async () => [];
    renderWithData(<ProjectsList />, { api });
    expect((await screen.findAllByText('No commits yet')).length).toBeGreaterThan(0);
  });
  it('the idea menu closes after an action, on Escape and on an outside click', async () => {
    renderWithData(<ProjectsList />);
    const toggle = await screen.findByLabelText('More: Add Chicago to the city picker');
    const menu = toggle.closest('details')!;
    await userEvent.click(toggle);
    expect(menu).toHaveAttribute('open');
    await userEvent.click(screen.getByRole('button', { name: 'Move down: Add Chicago to the city picker' }));
    expect(menu).not.toHaveAttribute('open');
    expect(toggle).toHaveFocus();
    await userEvent.click(toggle);
    await userEvent.keyboard('{Escape}');
    expect(menu).not.toHaveAttribute('open');
    expect(toggle).toHaveFocus();
    await userEvent.click(toggle);
    await userEvent.click(document.body);
    expect(menu).not.toHaveAttribute('open');
  });
  it('dropping an idea moves focus to the next row', async () => {
    renderWithData(<ProjectsList />);
    await userEvent.click(await screen.findByLabelText('More: Cache weather API responses'));
    await userEvent.click(screen.getByRole('button', { name: 'Drop: Cache weather API responses' }));
    expect(screen.getByLabelText('More: Add README screenshots')).toHaveFocus();
  });
  it('Work on this marks the idea in progress and queues one request, even on a double tap', async () => {
    const api = createDemoApi();
    const launch = vi.spyOn(api, 'requestLaunch');
    renderWithData(<ProjectsList />, { api });
    const btn = await screen.findByRole('button', { name: 'Work on this: Cache weather API responses' });
    await userEvent.dblClick(btn);
    expect(await screen.findByRole('button', { name: 'Queued for Mac: Cache weather API responses' })).toBeDisabled();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith('work_on_idea', { idea_id: 'i2', prev_status: 'todo' });
    const idea = (await api.listIdeas()).find((i) => i.id === 'i2')!;
    expect(idea.status).toBe('in_progress');
    expect(idea.started_at).not.toBeNull();
  });

  it('LEGO shows No repo linked and no GitHub link', async () => {
    renderWithData(<ProjectsList />);
    const card = (await screen.findByRole('heading', { name: 'LEGO' })).closest('section')!;
    expect(within(card).getByText('No repo linked')).toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: 'GitHub' })).toBeNull();
  });
});
