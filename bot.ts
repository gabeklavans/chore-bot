import "dotenv";
import { Bot } from "grammy";
import { StatelessQuestion } from "@grammyjs/stateless-question";
import { PrismaClient } from "@prisma/client";
import { User } from "@grammyjs/types";

const prisma = new PrismaClient();

// Create an instance of the `Bot` class and pass authentication token to it.
const bot = new Bot(process.env.BOT_API_KEY as string);

const queryChoreName = new StatelessQuestion("choreName", async (ctx) => {
	const name = ctx.message.text;
	console.log(name);

	if (!name) {
		ctx.reply("Please enter a valid name!");
	} else {
		const chore = await prisma.chore.create({
			data: {
				name: name as string,
			},
		});
		console.log(chore);

		ctx.reply(`Created chore: "${chore.name}"`);
	}
});

const queryUsers = new StatelessQuestion("usersList", async (ctx) => {
	console.log(ctx.message.entities);

	if (ctx.message.entities) {
		const chore = await prisma.chore.findFirst({
			where: { id: "6190a4578190340c57d3de00" },
		});

		const tgUsers: User[] = ctx.message.entities
			.filter((entity) => entity.type === "text_mention")
			.map((entity: any) => entity.user)
			.filter((user: User) => !user.is_bot);

		const users = tgUsers.map((users) => {
			return {
				tgId: users.id.toString(),
				choreId: chore!.id,
			};
		});

		// Clear out whatever was there already
		await prisma.weight.deleteMany({ where: { choreId: chore!.id } });
		// Create new weight entries for the users
		const numWeights = await prisma.weight.createMany({
			data: users,
		});

		ctx.reply(`${numWeights.count} users set for "${chore!.name}"`);
	}
});

bot.use(queryChoreName);
bot.use(queryUsers);

// React to /start command
bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));

bot.command("newchore", (ctx) => {
	return queryChoreName.replyWithMarkdown(
		ctx,
		`Enter a name for the Chore, i.e. "It's Tanner's turn to do <choreName>!"`
	);
});

bot.command("setusers", (ctx) => {
	console.log("set users invoked");

	return queryUsers.replyWithMarkdown(
		ctx,
		`Mention all the users to be assigned to this chore (this will erase the existing users).`
	);
});

// Handle other messages
// bot.on("message", async (ctx) => {
//     const users = await prisma.user.findMany();
//     ctx.reply(JSON.stringify(users));
// });

prisma.$connect().then(() => {
	console.log("DB Connected");
	console.log("Trying to start bot...");
	bot.start();
});
