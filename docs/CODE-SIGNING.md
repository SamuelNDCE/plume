# Code signing Plume

Unsigned Windows installers show the blue "Windows protected your PC" screen with **Unknown publisher**. Signing replaces "Unknown publisher" with a real name. Read the first section before choosing, because it sets expectations.

## What signing does and does not do

Per Microsoft's own guidance (Learn, "Code signing options for Windows app developers", updated 2026-08-29):

- Every option below shows the publisher name instead of "Unknown publisher".
- No signing option removes the SmartScreen warning instantly. Reputation builds over time as people download consecutive releases signed by the same identity. Extended Validation (EV) certificates stopped bypassing SmartScreen in 2024, so they are not worth the extra cost for this.
- The Microsoft Store (MSIX) is the one route with no warnings at all, because Microsoft re-signs the package. It is a different packaging and update path (see the last section).

## Options

| Option | Cost | Publisher shown | Notes |
| --- | --- | --- | --- |
| Azure Artifact Signing (formerly Trusted Signing) | about $9.99 per month | Your organisation's legal name | Organisations in the USA, Canada, EU and UK qualify; individuals only in the USA and Canada. Identity validation takes a few business days. No hardware token, built for CI. |
| SignPath Foundation | Free for qualifying open-source projects | "SignPath Foundation" | Needs an application and a "Code signing policy" section on the project's home page. See the conditions at https://signpath.org/terms.html |
| OV certificate (DigiCert, Sectigo and others) | about $150 to $300 per year | Your name or organisation | Private key must live on a hardware token or cloud HSM. |

macOS is separate: signing and notarising needs an Apple Developer account (paid). Until then macOS builds are unsigned and cannot update in place.

## Azure Artifact Signing: how this repository is already wired

`.github/workflows/release.yml` signs the Windows installer automatically when these exist, and builds unsigned (as today) when they do not.

1. In Azure, create an Artifact Signing account and complete identity validation, then create a certificate profile. Note the account name, profile name and the regional endpoint.
2. Create a Microsoft Entra app registration (service principal) and give it the "Artifact Signing Certificate Profile Signer" role on the account.
3. In the GitHub repository settings add:
   - Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
   - Variables: `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`
4. Tag a release. The "Build (Windows, signed)" step runs, and the installer and portable exe are signed.

Check the result after a release by downloading the setup exe and running `Get-AuthenticodeSignature .\Plume-<version>-win-x64-setup.exe` in PowerShell. `Status` should be `Valid` and the signer should be your organisation.

This pipeline change has not been run against a real Azure account yet, so expect to fix small details (such as the endpoint region) on the first signed run.

## SignPath Foundation

Plume meets the stated conditions on paper: MIT licence, no proprietary components, released, documented, and an uninstaller is included in the installer. To apply:

1. Apply at https://signpath.org/ with the repository URL https://github.com/SamuelNDCE/plume.
2. Add a "Code signing policy" section to the README with the wording and the team roles the programme requires (committers and reviewers, approvers) and a privacy statement. Plume's only network request is the optional update check to GitHub.
3. Everyone with signing or repository rights needs multi-factor authentication.
4. Integrate with their GitHub Action once approved. The certificate is issued to SignPath Foundation, so the publisher name is "SignPath Foundation", not yours.

## Microsoft Store (MSIX)

Store-distributed MSIX packages are re-signed by Microsoft and show no SmartScreen warning. It would need an MSIX build target and Store certification, and the Store handles updates, so the in-app updater would be turned off in that build. Not set up yet.
