# README

検証ノート: https://zenn.dev/hassaku63/scraps/81f042188d9323

## モチベ

ローカルの開発環境と実際のデプロイ実行環境 (GHA)、デプロイデプロイ先の Lambda でアーキテクチャが不統一なので、それを単一の Dockerfile で取り回せるようにしたかった

| env | arch |
| :--- | :--- |
| local (M1 Mac) | arm64 |
| GHA | amd64 |
| Lambda | arm64 |

ローカルでの `docker build` で問題なくハンドラの動作検証ができ、かつ実際のデプロイでも問題なく amd 向けのイメージが構成されデプロイできるようにしたかった

## 経緯

解決方法として、当初私はアーキテクチャごとにステージを構成した Dockerfile を用いており、デフォルトステージが amd64 を指すようにするアプローチを考えていた。

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

## 補足や未解消の疑問

いくつかある。

### 1. 当初のアイデアは妥当だったのか

同一の内容をプラットフォームごとに分離して個別のステージとして構成することが、Docker 的なプラクティスに従っているのか？

多少の検証を経てこの README を書いている時点では、あんまり必要じゃないような気がしている。

ローカルの検証では CDK アプリを動かす必要性がないことが多い。ので、手元での `docker build` をプラットフォームのオプション付きで実行すれば事足りると考えている。

ただ、自分の個人用 AWS アカウントに直接（Mac から）`cdk deploy` して動作を見たい場合もあるので、そういう場合は不都合しそうな気がする。

このケースでは `cdk deploy` の実行環境にバリエーションがあるので環境差異を考えたアプローチが必要になると考えている。ただ、それはこのソースのような「プラットフォームごとのステージを構成する」アプローチではない気もしている。

このへんプラクティスを持っている人がいたら是非伺いたい。

### 2. なぜ、デフォルトステージではない `build-arm64` が GHA で実行されてしまうのか

私が何か Docker の仕様で把握していない部分があり、単なる理解不足である可能性が最も高いと考えている。
が、現時点で原因はわからない。

以下は私の認識。これのどこかに思い違いがあるのでは、と疑っている。

- `docker build` はターゲット無指定なら最後に定義されたステージ（とそのステージが依存しているステージ）が実行される、という想定をしていた
  - 今回の検証コードでは `build-amd64` がデフォルトで、`build-arm64` は実行されない
- デプロイ時に実行される `docker build` は、`linux/amd64` の GHA のプラットフォームである
  - よって `build-arm64` は実行されないはず、と考えていた

自分の理解不足の可能性が最もありそうだと思っているが、CDK 側のバグの可能性も多少は想定している。
その理由は、CDK アプリケーションの側で AssetImage を構成する際に target を指定してみた場合の動作。

該当コミットはこれ

https://github.com/hassaku63/cdk-multi-stage-image-lambda-gha/commit/3b084a99858940029a62ea467cb156dfb6d29c3c

GHA で関連するログだけ抜粋すると以下

```
[09:50:16] CdkMultiStageImageLambdaGhaStack:  build: Building Docker image at /home/runner/work/cdk-multi-stage-image-lambda-gha/cdk-multi-stage-image-lambda-gha/cdk.out/asset.605c8af913d031315061bc31acacbed6a30c43ba4494119bc6988a8736569872
[09:50:16] CdkMultiStageImageLambdaGhaStack:  debug: docker build --tag cdkasset-605c8af913d031315061bc31acacbed6a30c43ba4494119bc6988a8736569872 --target build-amd64 .

Sending build context to Docker daemon  4.096kB
```

`docker build` で `--target build-amd64` が指定されている。これは CDK 側で実装した意図通り。

その直後実行されている `docker build` の Step 1 が以下

```
Step 1/8 : FROM --platform=linux/arm64 public.ecr.aws/lambda/python:3.9 AS build-arm64
3.9: Pulling from lambda/python
# ...
```

GHA のプラットフォームでもなく、CDK アプリケーション側で指示もしていない `build-arm64` が実行されている。これは想定外であり、期待した挙動とは異なる。

docker 側の仕様としてそういうものなのか、あるいは CDK が期待通りの挙動をしていないのか、だと考えられるが、それがどちらなのかは現時点の私の知識ではわからない。
