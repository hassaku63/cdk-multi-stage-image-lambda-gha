# README

検証ノート: https://zenn.dev/hassaku63/scraps/81f042188d9323

## 経緯

ローカルの開発環境と実際のデプロイ実行環境 (GHA)、デプロイデプロイ先の Lambda でアーキテクチャが不統一なので、それを単一の Dockerfile で取り回せるようにしたかった

| env | arch |
| :--- | :--- |
| local (M1 Mac) | arm64 |
| GHA | amd64 |
| Lambda | arm64 |

この解決方法として、当初私はアーキテクチャごとにステージを構成した Dockerfile を用いており、デフォルトステージが amd64 を指すようにするアプローチを考えていた。

```Dockerfile
# for Mac M1
FROM --platform=linux/arm64 public.ecr.aws/lambda/python:3.9 AS build-arm64

COPY requirements.txt  .
RUN  pip3 install -r requirements.txt --target "${LAMBDA_TASK_ROOT}" --verbose
COPY . ${LAMBDA_TASK_ROOT}

# CMD [ "handler.handler" ]

# for Lambda Runtime
FROM --platform=linux/amd64 public.ecr.aws/lambda/python:3.9

# Install the function's dependencies using file requirements.txt
# from your project folder.
COPY requirements.txt  .
RUN  pip3 install -r requirements.txt --target "${LAMBDA_TASK_ROOT}" --verbose
COPY . ${LAMBDA_TASK_ROOT}

# CMD [ "handler.handler" ]
```

この Dockerflie を使いつつ、CDK プロジェクトでは `aws_lambda.DockerImageCode.fromImageAsset` を platform/target を無指定にする。

```ts
import * as cdk from 'aws-cdk-lib'
import * as aws_lambda from 'aws-cdk-lib/aws-lambda'

const f = new aws_lambda.DockerImageFunction(scope, id, {
  code: aws_lambda.DockerImageCode.fromImageAsset(props.path, {
    cmd: [props.handler],
    file: props.dockerfile ? props.dockerfile : 'Dockerfile',
    // platform: ecr_assets.Platform.LINUX_AMD64,
    // target: 'build-amd64',,
  }),
  timeout: cdk.Duration.minutes(1),
  tracing: aws_lambda.Tracing.ACTIVE,
});
```

こうすることで、GHA (amd64) で実行するビルド、デプロイはデフォルトステージである adm64 向けのイメージが構成される...という想定だった。

しかし、実際には GHA からの初回デプロイは正常に機能するが、2回目以降のデプロイ（再現条件は不明）では arm64 のステージが実行されてしまいその結果エラーが生じデプロイが失敗する。

Link: https://zenn.dev/link/comments/326639770218cd

CDK アプリケーションの方で ImageAsset の作成時に platform/target を明示しても、arm64 がビルドされてしまう挙動は変化しなかった。

このコミットの時点で、まだ原因は解明できていない。

## 解決方法

今回の目的からすると、Dockerfile でのマルチステージビルドは必須ではない。

- ローカルでの検証は、CDK アプリケーションのライフサイクルには入らない
  - ローカルでの Dockerfile のビルド時に `--platform linux/amd64` を指定すれば OK
- GHA の実行環境とデプロイする Lambda の環境がどちらも amd64 で揃っているので、CDK アプリケーションとしては特段アーキテクチャの差異を考慮する必要がない

ので、CDK アプリケーションとしての実装は特に捻ったことをする必要がないし、Dockerfile も platform を明示しない単一のステージで構成すれば良い。

```Dockerfile
# M1 Mac のローカル開発環境では `--platform=linux/amd64` をオプション付きでビルドする
FROM public.ecr.aws/lambda/python:3.9

# Install the function's dependencies using file requirements.txt
# from your project folder.
COPY requirements.txt  .
RUN  pip3 install -r requirements.txt --target "${LAMBDA_TASK_ROOT}" --verbose
COPY . ${LAMBDA_TASK_ROOT}

# CMD [ "handler.handler" ]
```
