$ErrorActionPreference = 'Stop'

$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
Set-Location $PSScriptRoot\..

gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'GitHub 로그인이 필요합니다. 아래 명령을 실행한 뒤 브라우저에서 승인하세요.'
  Write-Host '  gh auth login --hostname github.com --git-protocol https --web'
  exit 1
}

$repoName = 'BATLog'
$owner = (gh api user --jq .login)
$remote = "https://github.com/$owner/$repoName.git"

if ($null -eq (git remote 2>$null | Select-String '^origin$')) {
  if (gh repo view "$owner/$repoName" 2>$null) {
    git remote add origin $remote
  } else {
    gh repo create $repoName --public --source=. --remote=origin --description 'Battery charging cycle log web app for marine drone operations'
  }
}

git push -u origin main

gh api "repos/$owner/$repoName/pages" -X POST -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/' 2>$null

Write-Host ''
Write-Host '완료'
Write-Host "저장소: https://github.com/$owner/$repoName"
Write-Host "Pages:  https://$owner.github.io/$repoName/ (배포까지 1~2분 소요)"
