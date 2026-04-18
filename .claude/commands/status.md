# /status — Project Status Dashboard

Report the current state of the KROMI BikeControl project:

1. **Git**: Run `git status` and `git log --oneline -5` to show branch, uncommitted changes, and recent commits
2. **Build**: Run `npm run build 2>&1 | tail -20` to check for TypeScript/build errors
3. **Dependencies**: Run `npm outdated --depth=0 2>/dev/null | head -15` for outdated packages
4. **Supabase**: Use the Supabase MCP to check project status and recent migrations via `mcp__claude_ai_Supabase__get_project` and `mcp__claude_ai_Supabase__list_migrations`
5. **Edge Functions**: Use `mcp__claude_ai_Supabase__list_edge_functions` to list deployed functions
6. **Deploy**: Check if Vercel deployment is current

Present results as a compact dashboard table. Flag any issues with warnings.
