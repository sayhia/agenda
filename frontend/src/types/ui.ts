export interface StatsData {
  total: number;
  today: number;
  nearDue: number;
  active: number;
  paused: number;
}

export type AgendaView = 'list' | 'week' | 'month' | 'matrix';
