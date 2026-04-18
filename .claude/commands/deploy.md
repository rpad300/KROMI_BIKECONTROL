# /deploy — Deploy Workflow

Deploy KROMI BikeControl to production. Steps:

1. Run `npm run type-check` — abort if TypeScript errors
2. Run `npm run build` — abort if build fails
3. Run `npm run test` if tests exist — warn if failures
4. Show the user a summary of what will be deployed (git diff from last deploy tag)
5. Ask for confirmation before proceeding
6. Run `vercel --prod` to deploy
7. After deploy, show the live URL and verify HTTPS is active
8. If user wants APK: remind to tag FIRST (`git tag vX.Y.Z`), then build APK

**Never deploy without build verification. Never skip the confirmation step.**
