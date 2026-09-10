import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const observations = sqliteTable('observations', {
  id: text('id').primaryKey(), league: text('league').notNull(), season: text('season').notNull(),
  competition: text('competition').notNull(), round: integer('round').notNull(),
  observedAt: text('observed_at').notNull(), importedAt: text('imported_at').notNull(),
  importedBy: text('imported_by').notNull(), body: text('body').notNull(),
}, t => [uniqueIndex('observation_scope_time').on(t.league,t.season,t.competition,t.round,t.observedAt),index('observation_league_time').on(t.league,t.observedAt)]);
