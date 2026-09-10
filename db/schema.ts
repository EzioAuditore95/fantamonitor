import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const observations = sqliteTable('observations', {
  id: text('id').primaryKey(), league: text('league').notNull(), season: text('season').notNull(),
  competition: text('competition').notNull(), round: integer('round').notNull(),
  observedAt: text('observed_at').notNull(), importedAt: text('imported_at').notNull(),
  importedBy: text('imported_by').notNull(), body: text('body').notNull(),
}, t => [uniqueIndex('observation_scope_time').on(t.league,t.season,t.competition,t.round,t.observedAt),index('observation_league_time').on(t.league,t.observedAt)]);

// Append-only adjudications; a correction creates the next revision.
export const lineupReviews = sqliteTable('lineup_reviews', {
  id:text('id').primaryKey(), league:text('league').notNull(), season:text('season').notNull(),
  competition:text('competition').notNull(), team:text('team').notNull(), round:integer('round').notNull(),
  revision:integer('revision').notNull(), recordedAt:text('recorded_at').notNull(),
  recordedBy:text('recorded_by').notNull(), body:text('body').notNull(),
},t=>[uniqueIndex('review_scope_revision').on(t.league,t.season,t.competition,t.team,t.round,t.revision)]);
