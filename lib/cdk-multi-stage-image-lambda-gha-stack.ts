import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as aws_lambda from 'aws-cdk-lib/aws-lambda'
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import { Construct, IConstruct } from 'constructs'

export class CdkMultiStageImageLambdaGhaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Aspects.of(this).add(new DisableRetainAspect());

    const func1 = createPythonLambdaFromAsset(this, 'Func1', {
      path: 'src',
      handler: 'main.func1',
    });
  }
}

interface CreatePythonLambdaFromAssetProps {
  path: string
  handler: string
}

function createPythonLambdaFromAsset(scope: Construct, id: string, props: CreatePythonLambdaFromAssetProps) {
  const f = new aws_lambda.DockerImageFunction(scope, id, {
    code: aws_lambda.DockerImageCode.fromImageAsset(props.path, {
      cmd: [props.handler],
      // platform: ecr_assets.Platform.LINUX_AMD64,
      target: 'build-amd64',
    }),
    timeout: cdk.Duration.minutes(1),
    tracing: aws_lambda.Tracing.ACTIVE,
  });

  new cdk.CfnOutput(scope, `${id}Arn`, {
    value: f.functionArn,
  });

  return f;
}

export class DisableRetainAspect implements cdk.IAspect {
  /**
   * 開発用途の Aspects リソース
   * デフォルトでは Retain ポリシーが定義されているリソースがいくつかあるので作り直しが面倒で作った
   */
  public visit(node: IConstruct): void {
    if (cdk.CfnResource.isCfnResource(node)) {
      node.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY)
    }
  }
}
