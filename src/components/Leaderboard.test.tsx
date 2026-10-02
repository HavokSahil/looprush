// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Leaderboard } from './Leaderboard';

afterEach(cleanup);

it('shows uploaded avatars, falls back on failed images, and identifies your results',()=>{
  const {container}=render(<Leaderboard playerId="alice" entries={[
    {id:'alice',name:'Alice',avatar:'/api/images/face.png',score:42.35,kills:12,runs:2},
    {id:'bob',name:'Bob',avatar:null,score:30,kills:4,runs:1},
  ]}/>);
  expect(screen.getByRole('list',{name:'All-time leaderboard'})).toBeTruthy();
  expect(screen.getByText('YOU')).toBeTruthy();
  expect(screen.getByText('42.35')).toBeTruthy();
  expect(screen.getByText(/12 cuts/).textContent).toContain('2 runs');
  const img=container.querySelector('img')!;
  expect(img.getAttribute('src')).toBe('/api/images/face.png');
  fireEvent.error(img);
  expect(img.style.display).toBe('none');
  expect(container.querySelectorAll('.avatar-badge')[0].textContent).toBe('A');
  expect(container.querySelectorAll('.avatar-badge')[1].textContent).toBe('B');
});
