import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPreview,supabaseEnvironmentConfigured} from '../lib/environment.ts';
const base={NEXT_PUBLIC_SUPABASE_URL:'https://production.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-test-key'};
test('production and local builds keep their configuration contract',()=>{
 assert.equal(supabaseEnvironmentConfigured(base),true);
 assert.equal(supabaseEnvironmentConfigured({...base,VERCEL_ENV:'production'}),true);
 assert.equal(supabaseEnvironmentConfigured({...base,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''}),false);
});
test('preview fails closed unless a distinct test project is configured',()=>{
 const preview={...base,VERCEL_ENV:'preview',FM_PRODUCTION_SUPABASE_PROJECT_REF:'production'};
 assert.equal(isPreview(preview),true);
 assert.equal(supabaseEnvironmentConfigured(preview),false);
 assert.equal(supabaseEnvironmentConfigured({...preview,FM_PREVIEW_SUPABASE_PROJECT_REF:'production'}),false);
 assert.equal(supabaseEnvironmentConfigured({...preview,FM_PREVIEW_SUPABASE_PROJECT_REF:'test'}),false);
 const ready={...preview,FM_PREVIEW_SUPABASE_PROJECT_REF:'test',NEXT_PUBLIC_SUPABASE_URL:'https://test.supabase.co'};
 assert.equal(supabaseEnvironmentConfigured(ready),true);
 assert.equal(supabaseEnvironmentConfigured({...ready,FM_PRODUCTION_SUPABASE_PROJECT_REF:''}),false);
 for(const url of ['invalid','http://test.supabase.co','https://test.supabase.co.example.com','https://production.supabase.co'])assert.equal(supabaseEnvironmentConfigured({...ready,NEXT_PUBLIC_SUPABASE_URL:url}),false,url);
});
