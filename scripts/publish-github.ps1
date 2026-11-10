# Run from a downloaded source folder or a clean local checkout.
# Requires Git and GitHub CLI already authenticated as ItsDeimox.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repository = 'ItsDeimox/configura'
$expectedOwner = 'ItsDeimox'
$projectRoot = Split-Path -Parent $PSScriptRoot
$startingDirectory = Get-Location

function Assert-LastCommand([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
}

try {
    Set-Location -LiteralPath $projectRoot
    foreach ($command in @('git', 'gh')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Install $command before publishing." }
    }
    if (-not (Test-Path package.json -PathType Leaf)) { throw 'Run this script from the Configura source project.' }
    $package = Get-Content package.json -Raw | ConvertFrom-Json
    if ($package.name -ne 'configura') { throw 'The current project is not Configura.' }

    gh auth status --hostname github.com
    Assert-LastCommand 'GitHub authentication check'
    $account = gh api user | ConvertFrom-Json
    Assert-LastCommand 'GitHub account lookup'
    if ($account.login -ine $expectedOwner) {
        throw "GitHub CLI is authenticated as $($account.login). Switch to $expectedOwner with gh auth switch first."
    }

    $newCheckout = -not (Test-Path .git)
    if ($newCheckout) {
        git init --initial-branch=main
        Assert-LastCommand 'Git initialization'
        $authorName = git config user.name
        if (-not $authorName) {
            $authorName = if ($account.name) { $account.name } else { $account.login }
            git config user.name $authorName
            Assert-LastCommand 'Local Git author name'
        }
        $authorEmail = git config user.email
        if (-not $authorEmail) {
            git config user.email "$($account.id)+$($account.login)@users.noreply.github.com"
            Assert-LastCommand 'Local Git author email'
        }
        git add --all
        Assert-LastCommand 'Stage source files'
        git commit -m "Release Configura $($package.version)"
        Assert-LastCommand 'Initial source commit'
    }

    $gitRoot = (git rev-parse --show-toplevel).Trim()
    Assert-LastCommand 'Repository root lookup'
    if ([IO.Path]::GetFullPath($gitRoot).TrimEnd('\', '/') -ine [IO.Path]::GetFullPath($projectRoot).TrimEnd('\', '/')) {
        throw 'The Configura folder is inside another Git repository. Refusing to publish the parent repository.'
    }
    $branch = (git branch --show-current).Trim()
    Assert-LastCommand 'Branch lookup'
    if ($branch -ne 'main') { throw 'Switch to the main branch before publishing.' }
    $changes = git status --porcelain
    Assert-LastCommand 'Working tree check'
    if ($changes) { throw 'Commit your current source changes before publishing. This script only pushes a clean checkout.' }
    $sourceSha = (git rev-parse HEAD).Trim()
    Assert-LastCommand 'Commit lookup'

    $existingRemote = git remote get-url origin 2>$null
    $remoteExit = $LASTEXITCODE
    if ($remoteExit -eq 0 -and $existingRemote -notmatch '^https://github\.com/ItsDeimox/configura(?:\.git)?/?$|^git@github\.com:ItsDeimox/configura(?:\.git)?$') {
        throw "origin points to $existingRemote. Refusing to change an unrelated remote."
    }

    $repoResult = gh api "repos/$repository" 2>&1
    $repoExit = $LASTEXITCODE
    if ($repoExit -eq 0) {
        $remoteRepo = ($repoResult -join "`n") | ConvertFrom-Json
        if ($remoteRepo.private) { throw 'The existing repository is private. Its visibility will not be changed by this script.' }
    } elseif (($repoResult -join "`n") -match '404') {
        gh repo create $repository --public --description 'A beautiful configuration editor for Windows. INI, CFG and other text configuration files.'
        Assert-LastCommand 'Public repository creation'
    } else {
        throw "Could not inspect the repository: $($repoResult -join ' ')"
    }

    if ($remoteExit -ne 0) {
        git remote add origin "https://github.com/$repository.git"
        Assert-LastCommand 'Set repository remote'
    }
    gh auth setup-git --hostname github.com
    Assert-LastCommand 'GitHub Git credential setup'
    git push --set-upstream origin HEAD:main
    if ($LASTEXITCODE -ne 0) {
        throw 'Push failed. No force push was attempted. If the remote has an initial README or other history, reconcile it before retrying.'
    }
    $remoteSha = (gh api "repos/$repository/git/ref/heads/main" --jq '.object.sha').Trim()
    Assert-LastCommand 'Published commit verification'
    if ($remoteSha -ne $sourceSha) { throw "Remote main is $remoteSha, expected $sourceSha. Inspect the remote before proceeding." }
    Write-Host "Published exact commit $sourceSha to https://github.com/$repository"
    Write-Host "Follow the Windows build and release: https://github.com/$repository/actions/workflows/release.yml"
} finally {
    Set-Location -LiteralPath $startingDirectory
}
