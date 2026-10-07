import {access} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
let mockConnector=true;
export function initialize(data){mockConnector=data?.mockConnector!==false;}
const mock=code=>({url:`data:text/javascript,${encodeURIComponent(code)}`,shortCircuit:true});
export async function resolve(specifier,context,nextResolve){
 if(specifier==='@/lib/supabase/server')return mock(`export function supabaseConfigured(){return globalThis.fmAuthFixture.configured;} export async function createClient(){return globalThis.fmAuthFixture.client;}`);
 if(specifier==='@/lib/league-server')return mock(`export async function loadLeagueConfig(slug){return globalThis.fmAuthFixture.configs[slug]??null;}`);
 if(specifier==='@/lib/archive'||specifier==='./archive'&&context.parentURL===new URL('lib/sync.ts',root).href)return mock(`export async function listSnapshots(){return [];} export async function listEvents(){return [];} export async function importSnapshots(){return {imported:1,duplicates:0};}`);
 if(specifier==='@/lib/reviews')return mock(`export async function listReviews(){return [];} export class ReviewConflict extends Error{} export async function saveReview(){throw new Error('unexpected review write');}`);
 if(specifier==='@/lib/sync'&&mockConnector)return mock(`export async function syncFromConnector(cfg){globalThis.fmAuthFixture.connectorCalls.push(cfg.id);return {imported:1};} export async function checkConnectorCredentials(cfg){globalThis.fmAuthFixture.connectorCalls.push(cfg.id);return {status:'verified'};}`);
 if(specifier==='@/lib/serie-a-store')return mock(`export async function syncSerieA(){throw new Error('unexpected cron import');}`);
 if(specifier.startsWith('@/'))return {url:new URL(`${specifier.slice(2)}.ts`,root).href,shortCircuit:true};
 if(specifier.startsWith('.')&&context.parentURL?.startsWith(root.href)){
  const url=new URL(specifier,context.parentURL);
  if(!/\.[a-z]+$/.test(url.pathname)){url.pathname+='.ts';try{await access(url);return {url:url.href,shortCircuit:true};}catch{}}
 }
 return nextResolve(specifier,context);
}
